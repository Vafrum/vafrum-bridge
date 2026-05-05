/**
 * BambuBridgeCoreAdapter
 *
 * Isolierter, in-memory Adapter, der pro Drucker einen Bambu Shadow-State
 * verwaltet und eingehende MQTT-Report-Payloads in vendor-neutrale Events
 * übersetzt. Reine Logikschicht – keine I/O, keine Persistenz, keine
 * Commands. Wird später von der echten Bridge konsumiert.
 *
 * Dieses Modul fasst keine bestehende Runtime-Datei an.
 */

import {
  isShadowStateStale,
  mapMergedBambuStateToEvents,
  mergeBambuReportIntoShadowState,
  type BambuShadowState,
  type BambuShadowStateContext,
  type ShadowModelClass,
} from '../mappers/bambu-shadow-state';
import type {
  BambuMapResult,
  BambuReportPayload,
  PreviousSnapshot,
} from '../mappers/bambu-event-mapper';
import type { EventSource, PrinterLifecycleState } from '../interfaces/printer-events';

// ─── Public types ───────────────────────────────────────────────────────────

/** Erweiterte Klassifizierung – `blocked` ist Adapter-Schicht, nicht State-Schicht. */
export type BridgeModelClass = ShadowModelClass | 'blocked';

export interface BambuPrinterConfig {
  serial: string;
  printerId: string;
  workspaceId: string;
  bridgeId: string | null;
  model?: string;
  modelClass?: BridgeModelClass;
  /** Stale-Schwelle in Sekunden, default 30. */
  staleAfterSeconds?: number;
}

export interface IngestMeta {
  /** ISO-8601 timestamp; default = `new Date().toISOString()`. */
  timestamp?: string;
  source?: EventSource;
  /** Optionaler Mapper-Vorzustand für Workflow-Transitions. */
  previous?: PreviousSnapshot;
  /** Wenn true, wird der Originalpayload als `raw.payload` an Events angehängt. */
  includeRawPayload?: boolean;
}

export type PrinterHealthStatus = 'online' | 'stale' | 'neverSeen' | 'blocked';

export interface PrinterHealth {
  serial: string;
  status: PrinterHealthStatus;
  /** Klassifizierung gemäß Function Map §8.1. */
  modelClass: BridgeModelClass;
  lastSeenAt: string | null;
  /** Sekunden seit `lastSeenAt`, oder `null` wenn nie gesehen. */
  stateAgeSeconds: number | null;
  hasFullState: boolean;
  /** Anzahl Events, die der letzte ingest erzeugt hat. */
  lastIngestEventCount: number;
  /** Anzahl ingest-Aufrufe insgesamt. */
  totalIngests: number;
  /** Anzahl `wasFullState`-Frames insgesamt. */
  totalFullStates: number;
}

export interface IngestResultAccepted {
  status: 'accepted';
  serial: string;
  /** Zusammengeführter Schatten-Zustand nach diesem Frame. */
  state: BambuShadowState;
  events: BambuMapResult & { isStale: boolean };
  health: PrinterHealth;
  /** True, wenn der Frame als Full-State erkannt wurde. */
  wasFullState: boolean;
  /** True, wenn der State durch den Frame inhaltlich verändert wurde. */
  changed: boolean;
}

export interface IngestResultRejected {
  status: 'rejected';
  serial: string;
  reason:
    | 'printer_not_registered'
    | 'invalid_payload'
    | 'model_blocked';
  /** Health auch bei rejected zurückgeben (oder null falls Drucker unbekannt). */
  health: PrinterHealth | null;
  message?: string;
}

export type IngestResult = IngestResultAccepted | IngestResultRejected;

// ─── Internal entry per printer ────────────────────────────────────────────

interface PrinterEntry {
  config: BambuPrinterConfig;
  state: BambuShadowState | null;
  totalIngests: number;
  totalFullStates: number;
  lastIngestEventCount: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_STALE_SECONDS = 30;

const nowIso = (): string => new Date().toISOString();

const ageSecondsBetween = (laterIso: string, earlierIso: string): number | null => {
  const a = Date.parse(earlierIso);
  const b = Date.parse(laterIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
};

/** Bridge-Klasse → State-Klasse. `blocked` ist auf der State-Schicht nicht
 *  vorgesehen, wir markieren den State stattdessen als `unknown`, damit er
 *  defensiv bleibt (keine experimentellen Interpretationen). */
const toShadowModelClass = (cls: BridgeModelClass | undefined): ShadowModelClass => {
  if (cls === 'blocked' || cls === 'unknown') return 'unknown';
  if (cls === 'experimental') return 'experimental';
  return 'safe';
};

const buildHealth = (
  entry: PrinterEntry,
  nowIsoArg: string | undefined,
): PrinterHealth => {
  const cfg = entry.config;
  const cls = cfg.modelClass ?? 'safe';
  const limit = cfg.staleAfterSeconds ?? DEFAULT_STALE_SECONDS;

  if (cls === 'blocked') {
    return {
      serial: cfg.serial,
      status: 'blocked',
      modelClass: 'blocked',
      lastSeenAt: entry.state?.lastSeenAt ?? null,
      stateAgeSeconds:
        entry.state ? ageSecondsBetween(nowIsoArg ?? nowIso(), entry.state.lastSeenAt) : null,
      hasFullState: entry.state?.hasFullState ?? false,
      lastIngestEventCount: entry.lastIngestEventCount,
      totalIngests: entry.totalIngests,
      totalFullStates: entry.totalFullStates,
    };
  }

  if (!entry.state) {
    return {
      serial: cfg.serial,
      status: 'neverSeen',
      modelClass: cls,
      lastSeenAt: null,
      stateAgeSeconds: null,
      hasFullState: false,
      lastIngestEventCount: entry.lastIngestEventCount,
      totalIngests: entry.totalIngests,
      totalFullStates: entry.totalFullStates,
    };
  }

  const stale = isShadowStateStale(entry.state, {
    staleAfterSeconds: limit,
    nowIso: nowIsoArg,
  });
  return {
    serial: cfg.serial,
    status: stale ? 'stale' : 'online',
    modelClass: cls,
    lastSeenAt: entry.state.lastSeenAt,
    stateAgeSeconds: ageSecondsBetween(nowIsoArg ?? nowIso(), entry.state.lastSeenAt),
    hasFullState: entry.state.hasFullState,
    lastIngestEventCount: entry.lastIngestEventCount,
    totalIngests: entry.totalIngests,
    totalFullStates: entry.totalFullStates,
  };
};

/**
 * Zählt Events im Map-Result für die Health-Statistik. Rein numerisch –
 * kein Inhalt wird gespeichert oder geloggt.
 */
const countEvents = (r: BambuMapResult): number => {
  let n = 1; // telemetry
  n += r.workflow.length;
  n += r.hms.length;
  n += r.materials.length;
  if (r.bridgeHealth) n += 1;
  return n;
};

const isUsablePayload = (p: unknown): p is BambuReportPayload =>
  !!p && typeof p === 'object';

// ─── Adapter ────────────────────────────────────────────────────────────────

export class BambuBridgeCoreAdapter {
  private printers: Map<string, PrinterEntry> = new Map();

  registerPrinter(config: BambuPrinterConfig): void {
    if (!config || typeof config.serial !== 'string' || config.serial.length === 0) {
      throw new Error('BambuBridgeCoreAdapter.registerPrinter: serial is required');
    }
    if (typeof config.printerId !== 'string' || typeof config.workspaceId !== 'string') {
      throw new Error('BambuBridgeCoreAdapter.registerPrinter: printerId + workspaceId are required');
    }
    const existing = this.printers.get(config.serial);
    if (existing) {
      // Re-register: behalte State, aktualisiere Config (nicht-destruktiv).
      existing.config = { ...existing.config, ...config };
      return;
    }
    this.printers.set(config.serial, {
      config: { modelClass: 'safe', staleAfterSeconds: DEFAULT_STALE_SECONDS, ...config },
      state: null,
      totalIngests: 0,
      totalFullStates: 0,
      lastIngestEventCount: 0,
    });
  }

  unregisterPrinter(serial: string): boolean {
    return this.printers.delete(serial);
  }

  /** Liefert eine Kopie des Shadow-States, oder `null` wenn unbekannt/leer. */
  getShadowState(serial: string): BambuShadowState | null {
    const entry = this.printers.get(serial);
    return entry?.state ?? null;
  }

  getAllShadowStates(): BambuShadowState[] {
    const out: BambuShadowState[] = [];
    for (const entry of this.printers.values()) {
      if (entry.state) out.push(entry.state);
    }
    return out;
  }

  getPrinterHealth(serial: string, nowIsoArg?: string): PrinterHealth | null {
    const entry = this.printers.get(serial);
    if (!entry) return null;
    return buildHealth(entry, nowIsoArg);
  }

  /** Anzahl registrierter Drucker (Tests/Diagnose). */
  size(): number {
    return this.printers.size;
  }

  clear(): void {
    this.printers.clear();
  }

  /**
   * Hauptpfad: rohe Bambu-Report-Payload aufnehmen, mergen, mappen,
   * Events + Health zurückgeben. Reine Logik – kein Logging des Payloads,
   * keine Commands, keine Secrets.
   */
  ingestReport(
    serial: string,
    payload: BambuReportPayload | null | undefined,
    meta: IngestMeta = {},
  ): IngestResult {
    const entry = this.printers.get(serial);
    if (!entry) {
      return {
        status: 'rejected',
        serial,
        reason: 'printer_not_registered',
        health: null,
        message: `Printer ${serial} is not registered`,
      };
    }

    const ts = meta.timestamp ?? nowIso();

    if (entry.config.modelClass === 'blocked') {
      // Drucker ist explizit gesperrt – Health zurück, aber kein Merge/Map.
      entry.totalIngests += 1;
      entry.lastIngestEventCount = 0;
      return {
        status: 'rejected',
        serial,
        reason: 'model_blocked',
        health: buildHealth(entry, ts),
        message: `Printer ${serial} is in modelClass=blocked`,
      };
    }

    if (!isUsablePayload(payload)) {
      // Defensiv: weder State stören noch crashen.
      return {
        status: 'rejected',
        serial,
        reason: 'invalid_payload',
        health: buildHealth(entry, ts),
        message: 'Payload was null/undefined or not an object',
      };
    }

    const ctx: BambuShadowStateContext = {
      serial,
      timestamp: ts,
      source:
        meta.source === 'bridge.lan' || meta.source === 'bridge.cloud' ||
        meta.source === 'backend.cloud' || meta.source === 'backend.derived'
          ? meta.source
          : 'bridge.lan',
      modelClass: toShadowModelClass(entry.config.modelClass),
      ...(entry.config.model ? { model: entry.config.model } : {}),
      printerId: entry.config.printerId,
      workspaceId: entry.config.workspaceId,
      bridgeId: entry.config.bridgeId,
    };

    const merge = mergeBambuReportIntoShadowState(entry.state, payload, ctx);
    entry.state = merge.state;
    entry.totalIngests += 1;
    if (merge.wasFullState) entry.totalFullStates += 1;

    const events = mapMergedBambuStateToEvents(entry.state, {
      printerId: entry.config.printerId,
      workspaceId: entry.config.workspaceId,
      bridgeId: entry.config.bridgeId,
      source: ctx.source,
      vendor: 'bambu',
      timestamp: ts,
      lastSeen: entry.state.lastSeenAt,
      staleAfterSeconds: entry.config.staleAfterSeconds,
      ...(meta.previous ? { previous: meta.previous } : {}),
      ...(meta.includeRawPayload ? { includeRawPayload: true } : {}),
    });

    entry.lastIngestEventCount = countEvents(events);
    const health = buildHealth(entry, ts);

    return {
      status: 'accepted',
      serial,
      state: entry.state,
      events,
      health,
      wasFullState: merge.wasFullState,
      changed: merge.changed,
    };
  }
}

// ─── Lifecycle re-export for consumers wanting a quick check ───────────────

export type { PrinterLifecycleState };
