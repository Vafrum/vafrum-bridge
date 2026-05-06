import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { buildPrinterStatusFromBambuReport } from '../../shared/mappers/bambu-status-mapper';
import { mapHmsArray } from '../../shared/mappers/bambu-hms-enricher';
import { buildBambuCommandPayloads } from '../../shared/bridge/commands';
import type { PrinterStatus, PrinterCommand, HmsEntry } from '../../shared/interfaces/printer-status';
import type { BambuPrintBlock } from '../../shared/mappers/bambu-event-mapper';

export interface PrinterConnectionConfig {
  printerId: string;
  serialNumber: string;
  model: string | null;
  ipAddress: string;
  accessCode: string;
}

export interface DiagnosticEvent {
  printerId: string;
  serial: string;
  ip?: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}

export interface PrinterClientEvents {
  onStatus: (status: PrinterStatus) => void;
  onDiagnostic?: (event: DiagnosticEvent) => void;
}

interface RustEvent {
  printerId: string;
  serial: string;
  model: string | null;
  raw: any;
}

export class PrinterEngine {
  private prevByPrinter = new Map<string, PrinterStatus>();
  /**
   * Stateful Cache pro Drucker: ams_id (string) → letztes info-Hex-String.
   * Bambu sendet `ams.ams[i].info` nur im pushall (nicht in deltas) — der Cache
   * sorgt dafuer dass die AMS↔Düsen-Zuordnung über alle Updates hinweg erhalten bleibt.
   * Analog zu Bambuddy state.ams_extruder_map. Kein Workaround — siehe
   * https://github.com/maziggy/bambuddy/blob/main/backend/app/services/bambu_mqtt.py
   */
  private amsInfoByPrinter = new Map<string, Map<string, string>>();
  private unlisten: UnlistenFn | null = null;
  private unlistenDiag: UnlistenFn | null = null;

  constructor(private events: PrinterClientEvents) {}

  async start(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<RustEvent>('printer-mqtt-message', (event) => {
      this.handleRust(event.payload);
    });
    this.unlistenDiag = await listen<DiagnosticEvent>('printer-mqtt-diagnostic', (event) => {
      this.events.onDiagnostic?.(event.payload);
    });
  }

  async stop(): Promise<void> {
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
    if (this.unlistenDiag) {
      this.unlistenDiag();
      this.unlistenDiag = null;
    }
  }

  async addPrinter(cfg: PrinterConnectionConfig): Promise<void> {
    await invoke('bridge_add_printer', {
      config: {
        printer_id: cfg.printerId,
        serial: cfg.serialNumber,
        ip: cfg.ipAddress,
        lan_password: cfg.accessCode,
        model: cfg.model ?? null,
      },
    });
  }

  async removePrinter(printerId: string): Promise<void> {
    await invoke('bridge_remove_printer', { printerId });
    this.prevByPrinter.delete(printerId);
    this.amsInfoByPrinter.delete(printerId);
  }

  async sendCommand(
    printerId: string,
    model: string | null,
    command: PrinterCommand,
  ): Promise<boolean> {
    const result = buildBambuCommandPayloads(command, model);
    if (!result.ok) return false;
    for (const payload of result.payloads) {
      await invoke('bridge_publish_command', { printerId, payload });
    }
    return true;
  }

  private handleRust(payload: RustEvent): void {
    const raw = payload.raw;
    if (!raw || typeof raw !== 'object') return;

    this.events.onDiagnostic?.({
      printerId: payload.printerId,
      serial: payload.serial,
      level: 'info',
      message: 'status-mapped-and-broadcasting',
    });

    try {
      const merged = this.buildMerged(raw);
      if (!merged || Object.keys(merged).length === 0) return;

      const prev = this.prevByPrinter.get(payload.printerId);
      const devicePayload = raw?.print?.device ?? raw?.device;

      // === Stateful AMS-info-Cache ===
      // info-Feld pro ams[i] in den merged-Block einsetzen wenn aktuell fehlt
      // (Delta-Updates dropen es haeufig). Cache pro Drucker, nie über Drucker hinweg.
      try {
        const amsBlock = (merged as any)?.ams;
        const amsArr = Array.isArray(amsBlock?.ams) ? amsBlock.ams : null;
        if (amsArr) {
          let cache = this.amsInfoByPrinter.get(payload.printerId);
          if (!cache) {
            cache = new Map<string, string>();
            this.amsInfoByPrinter.set(payload.printerId, cache);
          }
          for (const u of amsArr) {
            if (!u || typeof u !== 'object') continue;
            const id = u.id != null ? String(u.id) : null;
            if (!id) continue;
            if (typeof u.info === 'string' && u.info.length > 0) {
              cache.set(id, u.info);
            } else {
              const cached = cache.get(id);
              if (cached) u.info = cached;
            }
          }
        }
      } catch {
        // Cache-Update darf Mapper nicht crashen
      }

      let status = buildPrinterStatusFromBambuReport(
        payload.serial,
        merged,
        devicePayload,
        { model: payload.model, printerId: payload.printerId },
      );

      if (prev) {
        if (merged.nozzle_temper === undefined) status.nozzleTemp = prev.nozzleTemp;
        if (merged.nozzle_target_temper === undefined) status.nozzleTargetTemp = prev.nozzleTargetTemp;
        if (merged.bed_temper === undefined) status.bedTemp = prev.bedTemp;
        if (merged.bed_target_temper === undefined) status.bedTargetTemp = prev.bedTargetTemp;
        if (merged.mc_percent === undefined) status.printProgress = prev.printProgress;
        if (merged.mc_remaining_time === undefined) status.remainingTime = prev.remainingTime;
        if (merged.gcode_state === undefined) status.gcodeState = prev.gcodeState;
        if (merged.chamber_temper === undefined) status.chamberTemp = prev.chamberTemp;
      }

      if (status.hms && status.hms.length > 0) {
        const enriched = mapHmsArray(status.hms.map((e) => ({ attr: e.attr, code: e.code })));
        status.hms = enriched.map<HmsEntry>((e) => ({
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
      this.prevByPrinter.set(payload.printerId, status);
      this.events.onStatus(status);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const stackLine = err instanceof Error && err.stack
        ? err.stack.split('\n')[1]?.trim() ?? ''
        : '';
      this.events.onDiagnostic?.({
        printerId: payload.printerId,
        serial: payload.serial,
        level: 'error',
        message: `mapper-crash: ${errorMsg} | ${stackLine}`.slice(0, 400),
      });
    }
  }

  private buildMerged(raw: any): BambuPrintBlock {
    const print = raw?.print && typeof raw.print === 'object' ? raw.print : {};
    return { ...raw, ...print } as BambuPrintBlock;
  }
}
