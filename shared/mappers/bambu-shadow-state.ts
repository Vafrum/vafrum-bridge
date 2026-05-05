/**
 * Bambu Shadow-State / State-Merge layer.
 *
 * Wozu? Bambu sendet je nach Modell entweder volle Status-Frames (X1)
 * oder reine Delta-Updates (P1/A1). Vor dem Aufruf des bestehenden
 * `mapBambuReport`-Mappers wollen wir einen vollständigen, mergebaren
 * Schatten-Zustand pro Drucker führen, damit Delta-Frames keine Felder
 * "verlieren" (insbesondere AMS-Trays).
 *
 * Diese Datei ist isoliert: keine I/O, keine externen Abhängigkeiten
 * außer `shared/mappers/bambu-event-mapper.ts` für die Re-Use-Helper.
 *
 * Ausdrücklich NICHT enthalten:
 *  - MQTT-Subscribe/Publish
 *  - Persistenz
 *  - Commands
 *  - Modell-spezifische Auto-Aktivierung (H2C/Vortek/Dual-Nozzle bleiben
 *    "unknown/experimental" – Felder werden roh durchgereicht, aber
 *    nicht interpretiert).
 */

import {
  mapBambuReport,
  type BambuMapContext,
  type BambuMapResult,
  type BambuPrintBlock,
  type BambuReportPayload,
  type PreviousSnapshot,
} from './bambu-event-mapper';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * Wie wir den Drucker-Modus klassifizieren – in Übereinstimmung mit
 * docs/bridge/bambu-mqtt-function-map.md §8.
 */
export type ShadowModelClass = 'safe' | 'experimental' | 'unknown';

/** Optionaler Context-Hinweis je Drucker für die Merge-Schicht. */
export interface BambuShadowStateContext {
  serial: string;
  /** ISO-8601, wenn nicht gesetzt → `new Date().toISOString()`. */
  timestamp?: string;
  /** Quelle der eingehenden Nachricht (lan / cloud / derived). */
  source?: 'bridge.lan' | 'bridge.cloud' | 'backend.cloud' | 'backend.derived';
  /** Frei wählbarer Modellname; nur informativ, steuert keine Logik. */
  model?: string;
  /** Klassifizierung gemäß Function Map §8.1. */
  modelClass?: ShadowModelClass;
  /** Stale-Schwelle in Sekunden, default 30. */
  staleAfterSeconds?: number;
  /** Eindeutige ID des Druckers (Vafrum-intern). */
  printerId?: string;
  /** Workspace/Tenant. */
  workspaceId?: string;
  /** Bridge-ID, falls die Nachricht über eine Bridge kam. */
  bridgeId?: string | null;
}

/**
 * Schatten-Zustand pro Drucker.
 * Hält den letzten zusammengeführten `print`-Block plus Metadaten.
 *
 * `merged` ist absichtlich `BambuPrintBlock` (kein eigener Typ) – damit
 * der bestehende Mapper unverändert weiterverwendet werden kann.
 */
export interface BambuShadowState {
  serial: string;
  /** Erstes empfangenes Frame (ISO-8601). */
  firstSeenAt: string;
  /** Letztes empfangenes Frame (ISO-8601). */
  lastSeenAt: string;
  /** Anzahl integrierter Frames seit Erstellung. */
  updates: number;
  /** Letzte beobachtete Sequenz-ID, falls vorhanden. */
  lastSequenceId: string | null;
  /** True, wenn jemals ein Full-State (`msg=0`) gesehen wurde. */
  hasFullState: boolean;
  /** Klassifizierung gemäß Function Map §8.1. */
  modelClass: ShadowModelClass;
  /** Frei nutzbarer Modellhinweis (informativ). */
  model: string | null;
  /**
   * Letzter Frame so wie er reinkam (roh). Hilfreich für Debug
   * und für `BambuMapContext.includeRawPayload`.
   */
  lastRawPayload: BambuReportPayload | null;
  /** Zusammengeführter Print-Block (deep-merged). */
  merged: BambuPrintBlock;
}

export interface MergeResult {
  state: BambuShadowState;
  /** True, wenn der einkommende Payload `msg=0` (Full-State) war. */
  wasFullState: boolean;
  /** True, wenn das frühere `state.merged` durch den Merge geändert wurde. */
  changed: boolean;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_STALE_SECONDS = 30;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const extractPrintBlock = (payload: BambuReportPayload | undefined | null): BambuPrintBlock => {
  if (!payload || typeof payload !== 'object') return {};
  if ('print' in payload && (payload as { print?: unknown }).print && typeof (payload as { print?: unknown }).print === 'object') {
    return (payload as { print: BambuPrintBlock }).print;
  }
  return payload as BambuPrintBlock;
};

const ageSecondsBetween = (laterIso: string, earlierIso: string): number | null => {
  const a = Date.parse(earlierIso);
  const b = Date.parse(laterIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
};

/**
 * Erkennt einen Tray-/Slot-Eintrag mit `id`. Bambu liefert `id` als String
 * ("0".."3", "254") oder als Zahl. Wir behandeln beides.
 */
const trayKey = (item: unknown): string | null => {
  if (!isPlainObject(item)) return null;
  const id = item['id'];
  if (id === undefined || id === null) return null;
  return String(id);
};

/**
 * Spezial-Merge für AMS-Tray-Arrays: per `id` matchen und eintragsweise
 * tief mergen. Einträge im Delta ohne Match werden hinzugefügt.
 * Einträge im Vorgänger ohne Gegenstück bleiben erhalten.
 *
 * Erwartet Arrays beliebiger Länge – defensiv, kein Throw.
 */
const mergeTrayArray = (prev: unknown, next: unknown): unknown[] => {
  const prevArr = Array.isArray(prev) ? prev : [];
  const nextArr = Array.isArray(next) ? next : [];
  // Wenn keiner Tray-IDs trägt → nimm den jüngeren (defensiv).
  const prevHasKeys = prevArr.some(trayKey);
  const nextHasKeys = nextArr.some(trayKey);
  if (!prevHasKeys && !nextHasKeys) return nextArr.length > 0 ? nextArr : prevArr;

  const byKey = new Map<string, unknown>();
  const orderKeys: string[] = [];

  // Zuerst Vorgänger reinlegen, in Reihenfolge.
  for (const item of prevArr) {
    const k = trayKey(item);
    if (k === null) continue; // Einträge ohne id ignorieren wir hier
    byKey.set(k, item);
    orderKeys.push(k);
  }

  // Delta drüberlegen.
  for (const item of nextArr) {
    const k = trayKey(item);
    if (k === null) continue;
    if (byKey.has(k)) {
      byKey.set(k, deepMerge(byKey.get(k), item));
    } else {
      byKey.set(k, item);
      orderKeys.push(k);
    }
  }

  return orderKeys.map(k => byKey.get(k));
};

/**
 * Generischer Deep-Merge für plain objects.
 * - Arrays: standardmäßig Replace (Bambu-Konvention für die meisten Felder),
 *   außer wir erkennen ein Tray-/Slot-Array (Heuristik: Items mit `id`).
 * - Objekte: rekursiv.
 * - Primitive: replace, aber `undefined` aus dem Delta IGNORIEREN
 *   (= "Feld nicht enthalten"); `null` ist explizites Setzen.
 *
 * `next` darf neue Schlüssel hinzufügen – auch unbekannte Felder bleiben
 * roh erhalten (wichtig für H2C/Vortek/Dual-Nozzle "unknown" Felder).
 */
const deepMerge = (prev: unknown, next: unknown): unknown => {
  if (next === undefined) return prev;
  if (next === null) return null;
  if (Array.isArray(prev) && Array.isArray(next)) {
    // Heuristik: wenn sowohl prev als auch next id-tragende Objekte enthalten,
    // mergen wir per id; sonst replace.
    const prevHasKeys = prev.some(trayKey);
    const nextHasKeys = next.some(trayKey);
    if (prevHasKeys || nextHasKeys) return mergeTrayArray(prev, next);
    return next;
  }
  if (isPlainObject(prev) && isPlainObject(next)) {
    const out: Record<string, unknown> = { ...prev };
    for (const key of Object.keys(next)) {
      const v = next[key];
      if (v === undefined) continue;
      out[key] = deepMerge(prev[key], v);
    }
    return out;
  }
  return next;
};

/** Erkennt `print.command === 'push_status'` mit `msg === 0` (= Full-State). */
const looksLikeFullState = (block: BambuPrintBlock): boolean => {
  // Strikte Bambu-Konvention: msg=0 ist Full-State.
  if (typeof block.msg === 'number' && block.msg === 0) {
    // Heuristik: Full-States enthalten typischerweise Temperaturen UND gcode_state.
    // Wenn nur ein Mini-Frame mit msg=0 reinkommt (extrem selten), behandeln
    // wir es trotzdem als "Full-State signalisiert" — der Drucker meint es so.
    return true;
  }
  // Fallback-Heuristik: "fast alles drin" = wahrscheinlich full state, auch
  // wenn `msg` fehlt. Wir verlangen vier Kernfelder, sonst gilt es als Delta.
  let core = 0;
  if (block.gcode_state !== undefined) core++;
  if (block.nozzle_temper !== undefined) core++;
  if (block.bed_temper !== undefined) core++;
  if (block.mc_percent !== undefined) core++;
  return core >= 4;
};

const nowIso = (): string => new Date().toISOString();

// ─── Public API ─────────────────────────────────────────────────────────────

export function createEmptyShadowState(
  serial: string,
  ctx?: Partial<BambuShadowStateContext>,
): BambuShadowState {
  const now = ctx?.timestamp ?? nowIso();
  return {
    serial,
    firstSeenAt: now,
    lastSeenAt: now,
    updates: 0,
    lastSequenceId: null,
    hasFullState: false,
    modelClass: ctx?.modelClass ?? 'safe',
    model: ctx?.model ?? null,
    lastRawPayload: null,
    merged: {},
  };
}

/**
 * Merged einen eingehenden Bambu-MQTT-Report in den Schatten-Zustand.
 * Reine Funktion – mutiert weder `previousState` noch `incomingPayload`.
 */
export function mergeBambuReportIntoShadowState(
  previousState: BambuShadowState | null,
  incomingPayload: BambuReportPayload | null | undefined,
  context: BambuShadowStateContext,
): MergeResult {
  const ts = context.timestamp ?? nowIso();
  const prev = previousState ?? createEmptyShadowState(context.serial, context);

  // Defensive: kaputte/leere Payloads dürfen den State nicht stören.
  if (!incomingPayload || typeof incomingPayload !== 'object') {
    return {
      state: { ...prev, lastSeenAt: prev.lastSeenAt }, // lastSeenAt NICHT aktualisieren
      wasFullState: false,
      changed: false,
    };
  }

  const block = extractPrintBlock(incomingPayload);
  const isFull = looksLikeFullState(block);

  // Bei Full-State: vollständig ersetzen (aber merged bleibt typisiert);
  // wir behalten nur den serial und Metadaten.
  let mergedBlock: BambuPrintBlock;
  if (isFull) {
    mergedBlock = { ...block };
  } else if (Object.keys(block).length === 0) {
    // Reines no-op Frame.
    mergedBlock = prev.merged;
  } else {
    const merged = deepMerge(prev.merged, block);
    mergedBlock = isPlainObject(merged) ? (merged as BambuPrintBlock) : prev.merged;
  }

  const beforeJson = JSON.stringify(prev.merged);
  const afterJson = JSON.stringify(mergedBlock);
  const changed = beforeJson !== afterJson;

  const next: BambuShadowState = {
    serial: prev.serial,
    firstSeenAt: prev.firstSeenAt,
    lastSeenAt: ts,
    updates: prev.updates + 1,
    lastSequenceId:
      typeof block.sequence_id === 'string' || typeof block.sequence_id === 'number'
        ? String(block.sequence_id)
        : prev.lastSequenceId,
    hasFullState: prev.hasFullState || isFull,
    modelClass: context.modelClass ?? prev.modelClass,
    model: context.model ?? prev.model,
    lastRawPayload: incomingPayload,
    merged: mergedBlock,
  };

  return { state: next, wasFullState: isFull, changed };
}

/**
 * Liefert Sekunden seit `lastSeenAt`. Liefert `null` wenn keine Zeitangabe
 * geparst werden kann.
 */
export function getStateAgeSeconds(
  state: BambuShadowState | null,
  nowIsoArg?: string,
): number | null {
  if (!state) return null;
  const now = nowIsoArg ?? nowIso();
  return ageSecondsBetween(now, state.lastSeenAt);
}

/**
 * Default-Stale-Logik: > N Sekunden ohne Update gilt als stale.
 * - Kein State / kein Full-State je gesehen → stale (defensive Annahme).
 * - State älter als Schwelle → stale.
 *
 * "Status nicht stumpf auf 'ready' setzen, wenn nur alter Cache vorhanden ist."
 * Diese Funktion ist genau dafür: Konsumenten MÜSSEN sie befragen, bevor sie
 * Lifecycle-Entscheidungen aus `state.merged.gcode_state` ableiten.
 */
export function isShadowStateStale(
  state: BambuShadowState | null,
  options: { staleAfterSeconds?: number; nowIso?: string } = {},
): boolean {
  if (!state) return true;
  if (!state.hasFullState && state.updates === 0) return true;
  const limit = options.staleAfterSeconds ?? DEFAULT_STALE_SECONDS;
  const age = getStateAgeSeconds(state, options.nowIso);
  if (age === null) return true;
  return age > limit;
}

// ─── Integration mit bestehendem Mapper ────────────────────────────────────

export interface MapMergedContext extends Omit<BambuMapContext, 'serial' | 'lastSeen'> {
  /** Optionaler Override für `lastSeen` – default ist `state.lastSeenAt`. */
  lastSeen?: string;
  /** Stale-Schwelle in Sekunden (default 30). */
  staleAfterSeconds?: number;
  /**
   * Optionaler Vorzustand für den Mapper (z. B. zum Erkennen von Workflow-
   * Transitions). Wird unverändert durchgereicht.
   */
  previous?: PreviousSnapshot;
}

/**
 * Übersetzt den gemergten Schatten-Zustand in vendor-neutrale Events.
 * Verwendet intern `mapBambuReport`, sodass die bestehende Mapper-Logik
 * unverändert bleibt.
 *
 * Konsumenten erhalten zusätzlich `isStale`, damit sie nicht aus einem
 * alten Cache-State eine "ready"-Lifecycle-Entscheidung ableiten.
 */
export function mapMergedBambuStateToEvents(
  shadowState: BambuShadowState,
  ctx: MapMergedContext,
): BambuMapResult & { isStale: boolean } {
  const stale = isShadowStateStale(shadowState, {
    staleAfterSeconds: ctx.staleAfterSeconds,
    nowIso: ctx.timestamp,
  });
  // Wir geben den gemergten Block dem Mapper als `{print: …}`-Wrapper.
  const payload: BambuReportPayload = { print: shadowState.merged };
  const mapped = mapBambuReport(payload, {
    ...ctx,
    serial: shadowState.serial,
    lastSeen: ctx.lastSeen ?? shadowState.lastSeenAt,
  });
  return { ...mapped, isStale: stale };
}

// ─── Internal exports for tests ─────────────────────────────────────────────

export const __test = {
  deepMerge,
  mergeTrayArray,
  looksLikeFullState,
  extractPrintBlock,
};
