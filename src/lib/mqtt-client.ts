import mqtt, { MqttClient } from 'mqtt';
import { buildPrinterStatusFromBambuReport } from '../../shared/mappers/bambu-status-mapper';
import { mapHmsArray } from '../../shared/mappers/bambu-hms-enricher';
import { buildBambuCommandPayloads } from '../../shared/bridge/commands';
import type { PrinterStatus, PrinterCommand } from '../../shared/interfaces/printer-status';
import type { BambuPrintBlock } from '../../shared/mappers/bambu-event-mapper';

export interface PrinterConnectionConfig {
  printerId: string;
  serialNumber: string;
  model: string | null;
  ipAddress: string;
  accessCode: string;
}

export interface PrinterClientEvents {
  onStatus: (status: PrinterStatus) => void;
  onConnectionState: (printerId: string, connected: boolean) => void;
}

const RECOVERY_AFTER_NO_DATA_MS = 60_000;
const RECOVERY_INTERVAL_MS = 30_000;

export class PrinterMqttClient {
  private client: MqttClient | null = null;
  private prevStatus: PrinterStatus | null = null;
  private lastStatusReceived = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  constructor(
    private config: PrinterConnectionConfig,
    private events: PrinterClientEvents,
  ) {}

  connect(): void {
    const url = `mqtts://${this.config.ipAddress}:8883`;
    this.client = mqtt.connect(url, {
      username: 'bblp',
      password: this.config.accessCode,
      rejectUnauthorized: false,
      reconnectPeriod: 10_000,
      keepalive: 30,
      clientId: `vafrum_bridge_${this.config.serialNumber}_${Date.now()}`,
    });

    this.client.on('connect', () => {
      this.client!.subscribe(`device/${this.config.serialNumber}/report`, { qos: 1 });
      this.events.onConnectionState(this.config.printerId, true);
      this.lastStatusReceived = Date.now();
      this.requestPushAll();
      this.startWatchdog();
    });

    this.client.on('close', () => {
      this.events.onConnectionState(this.config.printerId, false);
      this.stopWatchdog();
    });

    this.client.on('error', (err) => {
      console.error(`[mqtt:${this.config.serialNumber}] error`, err.message);
    });

    this.client.on('message', (_topic, payload) => {
      try {
        const raw = JSON.parse(payload.toString());
        this.handleMessage(raw);
      } catch (err) {
        console.error(`[mqtt:${this.config.serialNumber}] parse error`, err);
      }
    });
  }

  disconnect(): void {
    this.stopWatchdog();
    this.client?.end(true);
    this.client = null;
  }

  sendCommand(command: PrinterCommand): boolean {
    if (!this.client?.connected) return false;
    const result = buildBambuCommandPayloads(command, this.config.model);
    if (!result.ok) return false;
    const topic = `device/${this.config.serialNumber}/request`;
    for (const payload of result.payloads) {
      this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
    }
    return true;
  }

  private handleMessage(raw: any): void {
    if (!raw || typeof raw !== 'object') return;

    const merged = this.buildMergedBlock(raw);
    if (!merged || Object.keys(merged).length === 0) return;

    const devicePayload = raw?.print?.device ?? raw?.device;
    let status = buildPrinterStatusFromBambuReport(
      this.config.serialNumber,
      merged,
      devicePayload,
      { printerId: this.config.printerId, model: this.config.model },
    );

    if (this.prevStatus) {
      if (merged.nozzle_temper === undefined) status.nozzleTemp = this.prevStatus.nozzleTemp;
      if (merged.nozzle_target_temper === undefined) status.nozzleTargetTemp = this.prevStatus.nozzleTargetTemp;
      if (merged.bed_temper === undefined) status.bedTemp = this.prevStatus.bedTemp;
      if (merged.bed_target_temper === undefined) status.bedTargetTemp = this.prevStatus.bedTargetTemp;
      if (merged.mc_percent === undefined) status.printProgress = this.prevStatus.printProgress;
      if (merged.mc_remaining_time === undefined) status.remainingTime = this.prevStatus.remainingTime;
      if (merged.gcode_state === undefined) status.gcodeState = this.prevStatus.gcodeState;
      if (merged.chamber_temper === undefined) status.chamberTemp = this.prevStatus.chamberTemp;
    }

    if (status.hms && status.hms.length > 0) {
      const enriched = mapHmsArray(status.hms.map((e) => ({ attr: e.attr, code: e.code })));
      status.hms = enriched.map((e) => ({
        attr: e.attr,
        code: e.code,
        formattedCode: e.formattedCode,
        module: e.module,
        severityLevel: e.severityLevel,
        ...(e.description !== undefined ? { description: e.description } : {}),
        wikiUrl: e.wikiUrl,
      }));
    }

    status.lastSeen = new Date();
    this.prevStatus = status;
    this.lastStatusReceived = Date.now();
    this.events.onStatus(status);
  }

  private buildMergedBlock(raw: any): BambuPrintBlock {
    const print = raw?.print && typeof raw.print === 'object' ? raw.print : {};
    return { ...raw, ...print } as BambuPrintBlock;
  }

  private requestPushAll(): void {
    if (!this.client?.connected) return;
    const payload = {
      pushing: { sequence_id: '0', command: 'pushall', version: 1, push_target: 1 },
    };
    this.client.publish(
      `device/${this.config.serialNumber}/request`,
      JSON.stringify(payload),
      { qos: 1 },
    );
  }

  private startWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = setInterval(() => {
      if (
        this.client?.connected &&
        Date.now() - this.lastStatusReceived >= RECOVERY_AFTER_NO_DATA_MS
      ) {
        this.requestPushAll();
      }
    }, RECOVERY_INTERVAL_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog) {
      clearInterval(this.watchdog);
      this.watchdog = null;
    }
  }
}
