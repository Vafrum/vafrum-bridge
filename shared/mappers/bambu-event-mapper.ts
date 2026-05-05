/**
 * Read-only Bambu MQTT → vendor-neutral event mapper.
 *
 * Pure function, no I/O, no side effects. Consumes a raw Bambu `report`
 * payload (entweder mit `print` als Wrapper oder direkt das `print`-Objekt)
 * und liefert Events, wie sie in shared/interfaces/printer-events.ts definiert sind.
 *
 * Scope (siehe Aufgabenstellung):
 *  - Telemetry IMMER (best-effort, mit nullbaren Feldern).
 *  - Workflow nur wenn aus dem Snapshot eine sinnvolle Phase ableitbar ist
 *    (online/offline-Eintritt erfordert previousState; print.* nur bei Übergang).
 *  - HMS pro Eintrag in `hms[]` einen `raised`-Event (cleared/updated benötigt
 *    State-Tracking jenseits dieses isolierten Mappers).
 *  - Material-Events nur wenn previousState übergeben wird (vorbereitet, nicht
 *    aktiviert für die normale Snapshot-Verarbeitung).
 *  - BridgeHealth nur als optionale "stale"-Beurteilung wenn `lastSeen` mitkommt.
 *
 * KEINE Commands.
 */

import type {
  BridgeHealthEvent,
  EventSource,
  FanReading,
  HmsModule,
  HmsSeverity,
  LightReading,
  MaterialIdentity,
  PrinterEventEnvelope,
  PrinterHmsEvent,
  PrinterLifecycleState,
  PrinterMaterialEvent,
  PrinterTelemetryEvent,
  PrinterVendor,
  PrinterWorkflowEvent,
  PrintProgress,
  RawSourcePayload,
  ThermalReading,
} from '../interfaces/printer-events';

// ─── Public Types ───────────────────────────────────────────────────────────

export interface BambuMapContext {
  printerId: string;
  serial: string;
  workspaceId: string;
  bridgeId: string | null;
  source?: EventSource;
  /** ISO-8601. Wenn fehlt → `new Date().toISOString()`. */
  timestamp?: string;
  /** Falls bekannt: H2D/H2C nutzen ein anderes JSON-Format. */
  vendor?: PrinterVendor;
  /** Wenn `true`, wird der Original-Payload als `raw.payload` mitgegeben. */
  includeRawPayload?: boolean;
  /** Optionaler vorheriger Snapshot, um Übergangs-/Material-Events abzuleiten. */
  previous?: PreviousSnapshot;
  /** Letzter physischer Kontakt (ISO-8601), für Telemetry und BridgeHealth-Stale. */
  lastSeen?: string;
  /** Monoton steigend, optional. */
  sequence?: number;
}

/**
 * Schmaler vorheriger Zustand. Wir wollen den Mapper isoliert halten und nicht
 * den vollen `PrinterTelemetryEvent` als Eingabe nehmen.
 */
export interface PreviousSnapshot {
  lifecycle?: PrinterLifecycleState;
  online?: boolean;
  jobName?: string | null;
  trayNow?: number | null;
  /** key = `${unit}:${slot}` */
  trays?: Record<string, MaterialIdentity>;
  hmsCodes?: string[];
  lastSeen?: string;
}

export interface BambuMapResult {
  telemetry: PrinterTelemetryEvent;
  workflow: PrinterWorkflowEvent[];
  hms: PrinterHmsEvent[];
  materials: PrinterMaterialEvent[];
  bridgeHealth: BridgeHealthEvent | null;
}

/** Bambu liefert manchmal `{print: {...}}`, manchmal direkt das print-Objekt. */
export type BambuReportPayload =
  | { print: BambuPrintBlock; [k: string]: unknown }
  | BambuPrintBlock;

export interface BambuPrintBlock {
  command?: string;
  msg?: number;
  sequence_id?: string;
  // ─ Druckstatus
  gcode_state?: string;
  gcode_file?: string;
  subtask_name?: string;
  mc_percent?: number;
  mc_remaining_time?: number;
  layer_num?: number;
  total_layer_num?: number;
  mc_print_stage?: number | string;
  mc_print_sub_stage?: number;
  stg_cur?: number;
  print_error?: number;
  print_type?: string;
  // ─ Temperaturen
  nozzle_temper?: number;
  nozzle_target_temper?: number;
  bed_temper?: number;
  bed_target_temper?: number;
  chamber_temper?: number;
  // ─ Lüfter (Strings 0-15 oder Zahlen)
  cooling_fan_speed?: string | number;
  big_fan1_speed?: string | number;
  big_fan2_speed?: string | number;
  heatbreak_fan_speed?: string | number;
  // ─ Speed
  spd_lvl?: number;
  spd_mag?: number;
  // ─ Lichter
  lights_report?: Array<{ node: string; mode: string }>;
  // ─ Netzwerk
  wifi_signal?: string | number;
  // ─ Online-Submodule
  online?: { ahb?: boolean; rfid?: boolean; version?: number };
  // ─ HMS
  hms?: Array<{ attr: number; code: number; action?: number; timestamp?: number }>;
  // ─ AMS
  ams?: BambuAmsBlock;
  vt_tray?: BambuTray;
  vir_slot?: BambuTray[];

  // §1.2 erweiterter Druck-Status
  fail_reason?: string;
  gcode_start_time?: string;
  gcode_file_prepare_percent?: number;
  s_obj?: number[];
  ams_mapping?: number[];
  mc_print_error_code?: number;
  subtask_id?: string;
  project_id?: string;
  task_id?: string;

  // §1.4 Lüfter (heatbreak_fan_speed bereits vorhanden)
  aux_part_fan?: number;

  // §1.6 Beleuchtung Erweiterung — chamber_light2 ist im lights_report-Array
  // (wird hier nicht extra ergänzt, da lights_report bereits Array<{node, mode}> ist)

  // §1.9 Hardware-Bits und Flags
  home_flag?: number | string;
  stat?: number | string;
  fun?: number | string;
  hw_switch_state?: number;
  nozzle_diameter?: number;
  nozzle_type?: string;
  sdcard?: boolean | string;
  net?: BambuNetBlock;

  // §1.9 Camera (ipcam)
  ipcam?: BambuIpcamBlock;

  // §1.9 XCam
  xcam?: BambuXcamBlock;

  // §1.10 Firmware / Upgrade
  upgrade_state?: BambuUpgradeStateBlock;

  [k: string]: unknown;
}

export interface BambuAmsBlock {
  ams?: Array<{
    id?: string;
    humidity?: string;
    humidity_raw?: number;
    temp?: string;
    dry_time?: number;
    tray?: BambuTray[];
  }>;
  ams_exist_bits?: string;
  tray_exist_bits?: string;
  tray_is_bbl_bits?: number;
  tray_read_done_bits?: number;
  tray_now?: string;
  tray_pre?: string;
  tray_tar?: string;
  version?: number;
}

export interface BambuTray {
  id?: string | number;
  tray_id_name?: string;
  tray_type?: string;
  tray_sub_brands?: string;
  tray_color?: string;
  tray_info_idx?: string;
  tray_uuid?: string;
  tag_uid?: string;
  tray_weight?: string | number;
  remain?: number;
  k?: number;
  nozzle_temp_min?: string | number;
  nozzle_temp_max?: string | number;
  bed_temp?: number;
  xcam_info?: string;
}

// ─── Sub-Blöcke für §1.9 / §1.10 ────────────────────────────────────────────

export interface BambuNetBlock {
  conf?: string;
  info?: BambuNetInterface[];
}

export interface BambuNetInterface {
  type?: string;
  ip?: string;
  mask?: string;
  gateway?: string;
  mac?: string;
}

export interface BambuIpcamBlock {
  ipcam_record?: string;
  timelapse?: string;
  resolution?: string;
  mode_bit?: number;
  mode_bits?: number;
  tutk_server?: string;
  rtsp_url?: string;
}

export interface BambuXcamBlock {
  first_layer_inspector?: boolean;
  spaghetti_detector?: boolean;
  buildplate_marker_detector?: boolean;
  print_halt?: boolean;
  printing_monitor?: boolean;
  allow_skip_parts?: boolean;
  halt_print_sensitivity?: string;
}

export interface BambuUpgradeStateBlock {
  status?: string;
  progress?: string;
  new_version_state?: number;
  new_ver_list?: BambuUpgradeVersion[];
  module?: BambuFirmwareModule[];
}

export interface BambuUpgradeVersion {
  name: string;
  cur_ver?: string;
  new_ver?: string;
  flag?: number;
}

export interface BambuFirmwareModule {
  name: string;
  sw_ver?: string;
  hw_ver?: string;
  sn?: string;
  loader_ver?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const STALE_THRESHOLD_SECONDS = 30;

const toNumberOrNull = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const toIntOrNull = (v: unknown): number | null => {
  const n = toNumberOrNull(v);
  return n === null ? null : Math.trunc(n);
};

/** Bambu-Lüfter sind 0–15. Liefert 0–100 % gerundet, oder null. */
const fanToPercent = (v: unknown): number | null => {
  const n = toNumberOrNull(v);
  if (n === null) return null;
  const clamped = Math.max(0, Math.min(15, n));
  return Math.round((clamped / 15) * 100);
};

/** wifi_signal: kommt als "-53dBm" oder "-53" oder Zahl. */
const wifiToDbm = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const m = v.match(/-?\d+/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
};

/** Akzeptiert Wrapper oder rohes print-Objekt. */
const extractPrintBlock = (payload: BambuReportPayload | undefined | null): BambuPrintBlock => {
  if (!payload || typeof payload !== 'object') return {};
  if ('print' in payload && payload.print && typeof payload.print === 'object') {
    return payload.print as BambuPrintBlock;
  }
  return payload as BambuPrintBlock;
};

const normalizeColorHex = (c: string | undefined | null): string | null => {
  if (!c || typeof c !== 'string') return null;
  // Bambu liefert RRGGBBAA. Wir wollen RRGGBB ohne #.
  const trimmed = c.trim().replace(/^#/, '');
  if (trimmed.length === 0 || /^0+$/.test(trimmed)) return null;
  if (trimmed.length === 8) return trimmed.slice(0, 6).toUpperCase();
  if (trimmed.length === 6) return trimmed.toUpperCase();
  return trimmed.toUpperCase();
};

// gcode_state -> lifecycle
const mapLifecycle = (state: string | undefined): PrinterLifecycleState => {
  if (!state) return 'unknown';
  const s = state.toUpperCase();
  switch (s) {
    case 'IDLE': return 'idle';
    case 'PREPARE': return 'preparing';
    case 'RUNNING': return 'printing';
    case 'PAUSE': return 'paused';
    case 'FINISH': return 'finished';
    case 'FAILED': return 'failed';
    case 'INIT': return 'preparing';
    case 'SLICING': return 'preparing';
    case 'OFFLINE': return 'offline';
    default: return 'unknown';
  }
};

/** mc_print_stage / stg_cur -> lesbarer Aktivitätsname (defensiv). */
const STAGE_NAMES: Record<number, string> = {
  0: 'printing',
  1: 'auto_bed_leveling',
  2: 'heatbed_preheating',
  3: 'sweeping_xy_mech_mode',
  4: 'changing_filament',
  5: 'm400_pause',
  6: 'paused_filament_runout',
  7: 'heating_hotend',
  8: 'calibrating_extrusion',
  9: 'scanning_bed_surface',
  10: 'inspecting_first_layer',
  11: 'identifying_build_plate_type',
  12: 'calibrating_micro_lidar',
  13: 'homing_toolhead',
  14: 'cleaning_nozzle_tip',
  15: 'checking_extruder_temperature',
  16: 'paused_user',
  17: 'paused_front_cover_falling',
  19: 'calibrating_extrusion_flow',
  20: 'paused_nozzle_temperature_malfunction',
  21: 'paused_heat_bed_temperature_malfunction',
  22: 'filament_unloading',
  23: 'paused_skipped_step',
  24: 'filament_loading',
  25: 'calibrating_motor_noise',
  26: 'paused_ams_lost',
  27: 'paused_low_fan_speed_heat_break',
  28: 'paused_chamber_temperature_control_error',
  29: 'cooling_chamber',
  30: 'paused_user_gcode',
  31: 'motor_noise_showoff',
  32: 'paused_nozzle_filament_covered_detected',
  33: 'paused_cutter_error',
  34: 'paused_first_layer_error',
  35: 'paused_nozzle_clog',
  18: 'calibrating_micro_lidar',
  36: 'check_absolute_accuracy_before_calibration',
  37: 'absolute_accuracy_calibration',
  38: 'check_absolute_accuracy_after_calibration',
  39: 'calibrate_nozzle_offset',
  40: 'bed_level_high_temperature',
  41: 'check_quick_release',
  42: 'check_door_and_cover',
  43: 'laser_calibration',
  44: 'check_platform',
  45: 'check_birdeye_camera_position',
  46: 'calibrate_birdeye_camera',
  47: 'bed_level_phase_1',
  48: 'bed_level_phase_2',
  49: 'heating_chamber',
  50: 'heated_bed_cooling',
  51: 'print_calibration_lines',
  255: 'idle',
};

const stageName = (block: BambuPrintBlock): string | null => {
  const stg = toIntOrNull(block.stg_cur);
  if (stg !== null) {
    if (stg === -1 || stg === 255) return 'idle';
    return STAGE_NAMES[stg] ?? `stage_${stg}`;
  }
  const ps = toIntOrNull(block.mc_print_stage);
  if (ps !== null) return STAGE_NAMES[ps] ?? `stage_${ps}`;
  return null;
};

// HMS-Helper sind in bambu-hms-enricher.ts konsolidiert.
import {
  formatHmsCode,
  buildHmsWikiUrl,
  getHmsModule,
  getHmsSeverity,
} from './bambu-hms-enricher';

// ─── Envelope-Builder ───────────────────────────────────────────────────────

const buildEnvelope = (
  ctx: BambuMapContext,
  raw: BambuPrintBlock,
  rawPayload: BambuReportPayload,
): PrinterEventEnvelope => {
  const envelope: PrinterEventEnvelope = {
    printerId: ctx.printerId,
    serial: ctx.serial,
    workspaceId: ctx.workspaceId,
    bridgeId: ctx.bridgeId,
    source: ctx.source ?? 'bridge.lan',
    vendor: ctx.vendor ?? 'bambu',
    timestamp: ctx.timestamp ?? new Date().toISOString(),
  };
  if (ctx.sequence !== undefined) envelope.sequence = ctx.sequence;
  if (ctx.includeRawPayload) {
    const rsp: RawSourcePayload = {
      vendor: ctx.vendor ?? 'bambu',
      channel: `device/${ctx.serial}/report`,
      payload: rawPayload,
    };
    if (raw.sequence_id !== undefined) rsp.sourceSequenceId = raw.sequence_id;
    envelope.raw = rsp;
  }
  return envelope;
};

// ─── Telemetry-Builder ──────────────────────────────────────────────────────

const buildThermals = (b: BambuPrintBlock): ThermalReading[] => {
  const list: ThermalReading[] = [
    {
      component: 'nozzle',
      current: toNumberOrNull(b.nozzle_temper),
      target: toNumberOrNull(b.nozzle_target_temper),
    },
    {
      component: 'bed',
      current: toNumberOrNull(b.bed_temper),
      target: toNumberOrNull(b.bed_target_temper),
    },
  ];
  const chamber = toNumberOrNull(b.chamber_temper);
  if (chamber !== null) list.push({ component: 'chamber', current: chamber, target: null });
  return list;
};

const buildFans = (b: BambuPrintBlock): FanReading[] => {
  const list: FanReading[] = [];
  const part = fanToPercent(b.cooling_fan_speed);
  if (part !== null) list.push({ channel: 'part', speedPercent: part });
  const aux = fanToPercent(b.big_fan1_speed);
  if (aux !== null) list.push({ channel: 'aux', speedPercent: aux });
  const chamber = fanToPercent(b.big_fan2_speed);
  if (chamber !== null) list.push({ channel: 'chamber', speedPercent: chamber });
  const heatbreak = fanToPercent(b.heatbreak_fan_speed);
  if (heatbreak !== null) list.push({ channel: 'heatbreak', speedPercent: heatbreak });
  return list;
};

const buildLights = (b: BambuPrintBlock): LightReading[] => {
  const list: LightReading[] = [];
  if (!Array.isArray(b.lights_report)) return list;
  for (const l of b.lights_report) {
    if (!l || typeof l !== 'object') continue;
    const node = String(l.node ?? '');
    const on = String(l.mode ?? '').toLowerCase() === 'on';
    switch (node) {
      case 'chamber_light': list.push({ channel: 'chamber', on }); break;
      case 'chamber_light2': list.push({ channel: 'chamber2', on }); break;
      case 'work_light': list.push({ channel: 'work', on }); break;
      case 'heatbed_light': list.push({ channel: 'heatbed', on }); break;
    }
  }
  return list;
};

const buildProgress = (b: BambuPrintBlock): PrintProgress => {
  const minutes = toNumberOrNull(b.mc_remaining_time);
  const file = (b.subtask_name && String(b.subtask_name).trim()) ||
               (b.gcode_file && String(b.gcode_file).trim()) ||
               null;
  return {
    percent: toNumberOrNull(b.mc_percent),
    remainingSeconds: minutes === null ? null : Math.round(minutes * 60),
    currentLayer: toIntOrNull(b.layer_num),
    totalLayers: toIntOrNull(b.total_layer_num),
    jobName: file && file.length > 0 ? file : null,
    jobId: null,
  };
};

const mapSpeedLevel = (raw: unknown): 1 | 2 | 3 | 4 | null => {
  const n = toIntOrNull(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return null;
};

// ─── Material-Helfer ────────────────────────────────────────────────────────

const buildMaterialIdentity = (t: BambuTray | undefined): MaterialIdentity | null => {
  if (!t) return null;
  const colorHex = normalizeColorHex(t.tray_color ?? null);
  const material = (t.tray_type ?? '').toString() || null;
  const subBrand = (t.tray_sub_brands ?? '').toString() || null;
  const display = subBrand || material;
  const remainPct = toNumberOrNull(t.remain);
  const weight = toNumberOrNull(t.tray_weight);
  return {
    spoolId: null,
    material,
    colorHex,
    displayName: display,
    vendorProfileId: t.tray_info_idx ? String(t.tray_info_idx) : null,
    rfidTagUid: t.tag_uid ? String(t.tag_uid) : null,
    vendorTrayUuid: t.tray_uuid ? String(t.tray_uuid) : null,
    remainingPercent: remainPct,
    remainingGrams: weight,
    nozzleTempMin: toNumberOrNull(t.nozzle_temp_min),
    nozzleTempMax: toNumberOrNull(t.nozzle_temp_max),
    bedTemp: toNumberOrNull(t.bed_temp),
    xcamInfo: t.xcam_info ?? null,
  };
};

const collectTrayMap = (b: BambuPrintBlock): Record<string, MaterialIdentity> => {
  const out: Record<string, MaterialIdentity> = {};
  if (!b.ams || !Array.isArray(b.ams.ams)) return out;
  for (const unit of b.ams.ams) {
    if (!unit || !Array.isArray(unit.tray)) continue;
    const unitId = toIntOrNull(unit.id) ?? 0;
    for (const tray of unit.tray) {
      const slot = toIntOrNull(tray?.id);
      if (slot === null) continue;
      const ident = buildMaterialIdentity(tray);
      if (!ident) continue;
      // Slots ohne Filament (nur 0er-Farbe) filtern wir nicht — der Nutzer kann
      // das in der UI selbst prüfen. Aber: leere Slots (kein Material, keine
      // Farbe, keine Tag-UID) lassen wir weg.
      if (!ident.material && !ident.colorHex && !ident.rfidTagUid && !ident.vendorTrayUuid) {
        continue;
      }
      out[`${unitId}:${slot}`] = ident;
    }
  }
  return out;
};

// ─── Main: mapBambuReport ───────────────────────────────────────────────────

let _idSeed = 0;
const nextId = (prefix: string): string => {
  _idSeed = (_idSeed + 1) >>> 0;
  return `${prefix}_${Date.now().toString(36)}_${_idSeed.toString(36)}`;
};

export function mapBambuReport(
  payload: BambuReportPayload,
  ctx: BambuMapContext,
): BambuMapResult {
  const block = extractPrintBlock(payload);
  const envelope = buildEnvelope(ctx, block, payload);
  const lifecycle = mapLifecycle(block.gcode_state);
  const stage = stageName(block);
  const progress = buildProgress(block);
  const thermals = buildThermals(block);
  const fans = buildFans(block);
  const lights = buildLights(block);
  const speedLevel = mapSpeedLevel(block.spd_lvl);
  const speedMag = toNumberOrNull(block.spd_mag);
  const wifi = wifiToDbm(block.wifi_signal);
  const lastSeen = ctx.lastSeen ?? envelope.timestamp;

  // Telemetry — wenn lifecycle="unknown" und kein State-Feld da ist, nehmen
  // wir online=true an (wir haben gerade einen Frame empfangen).
  const online = lifecycle !== 'offline';

  const telemetry: PrinterTelemetryEvent = {
    ...envelope,
    kind: 'telemetry',
    lifecycle,
    online,
    lastSeen,
    progress,
    thermals,
    fans,
    lights,
    speedLevel,
    speedMagnification: speedMag,
    network: { wifiDbm: wifi, ipAddress: null },
    activeAlertCount: Array.isArray(block.hms) ? block.hms.length : 0,
  };

  // ─── Workflow ─────────────────────────────────────────────────────────────
  const workflow: PrinterWorkflowEvent[] = [];
  const prev = ctx.previous;
  if (prev) {
    // online/offline edge
    if (prev.online !== undefined && prev.online !== online) {
      workflow.push({
        ...envelope,
        kind: 'workflow',
        type: online ? 'printer.online' : 'printer.offline',
        previousState: prev.lifecycle ?? null,
        currentState: lifecycle,
        job: null,
        reason: online ? null : 'unknown',
      });
    }
    // print state transitions
    if (prev.lifecycle && prev.lifecycle !== lifecycle) {
      const transition = mapPrintTransition(prev.lifecycle, lifecycle);
      if (transition) {
        workflow.push({
          ...envelope,
          kind: 'workflow',
          type: transition.type,
          previousState: prev.lifecycle,
          currentState: lifecycle,
          job: progress.jobName || progress.percent !== null
            ? {
                jobId: progress.jobId,
                jobName: progress.jobName,
                progressPercent: progress.percent,
                durationSeconds: null,
              }
            : null,
          reason: transition.reason,
          ...(stage ? { note: `stage:${stage}` } : {}),
        });
      }
    }
  }

  // ─── HMS ──────────────────────────────────────────────────────────────────
  const hms: PrinterHmsEvent[] = [];
  if (Array.isArray(block.hms)) {
    const previousCodes = new Set(prev?.hmsCodes ?? []);
    for (const entry of block.hms) {
      if (!entry || typeof entry !== 'object') continue;
      const attr = toIntOrNull(entry.attr);
      const code = toIntOrNull(entry.code);
      if (attr === null || code === null) continue;
      const codeStr = formatHmsCode(attr, code);
      const isNew = previousCodes.size > 0 ? !previousCodes.has(codeStr) : true;
      hms.push({
        ...envelope,
        kind: 'hms',
        hmsEventId: nextId('hms'),
        lifecycle: isNew ? 'raised' : 'updated',
        severity: getHmsSeverity(code),
        module: getHmsModule(attr),
        code: codeStr,
        description: null,
        descriptionLocale: 'unknown',
        documentationUrl: buildHmsWikiUrl(codeStr),
        recommendedAction: null,
        firstSeenAt: envelope.timestamp,
        clearedAt: null,
      });
    }
  }

  // ─── Material-Events (nur wenn previous übergeben wurde) ──────────────────
  const materials: PrinterMaterialEvent[] = [];
  const currentTrays = collectTrayMap(block);
  const trayNow = block.ams ? toIntOrNull(block.ams.tray_now) : null;
  if (prev) {
    const prevTrays = prev.trays ?? {};
    const allKeys = new Set([...Object.keys(prevTrays), ...Object.keys(currentTrays)]);
    for (const key of allKeys) {
      const [unitStr, slotStr] = key.split(':');
      const unit = Number(unitStr);
      const slot = Number(slotStr);
      const before = prevTrays[key] ?? null;
      const after = currentTrays[key] ?? null;
      if (!before && after) {
        materials.push(buildMaterialEvent(envelope, 'material.loaded', unit, slot, before, after, trayNow));
      } else if (before && !after) {
        materials.push(buildMaterialEvent(envelope, 'material.unloaded', unit, slot, before, after, trayNow));
      } else if (before && after && !materialIdentityEqual(before, after)) {
        materials.push(buildMaterialEvent(envelope, 'material.changed', unit, slot, before, after, trayNow));
      }
    }
    // tray_now Wechsel
    if (prev.trayNow !== undefined && prev.trayNow !== trayNow) {
      materials.push({
        ...envelope,
        kind: 'material',
        type: 'material.tray_now_changed',
        amsUnit: null,
        slot: trayNow,
        isActiveTray: true,
        current: null,
        previous: null,
        suggestions: [],
      });
    }
  }

  // ─── Bridge Health (vorbereiten, nur wenn lastSeen mitkommt) ─────────────
  let bridgeHealth: BridgeHealthEvent | null = null;
  if (ctx.lastSeen && ctx.bridgeId) {
    const ageSec = ageInSeconds(ctx.lastSeen, envelope.timestamp);
    const stale = ageSec !== null && ageSec > STALE_THRESHOLD_SECONDS;
    bridgeHealth = {
      ...envelope,
      kind: 'bridge.health',
      status: stale ? 'stale' : 'healthy',
      transport: 'lan_mqtt',
      bridgeVersion: null,
      inStatusForSeconds: ageSec ?? 0,
      managedPrinterCount: 1,
      freshPrinterCount: stale ? 0 : 1,
      lastReconnectAt: null,
      reconnectsLast5Min: 0,
      diagnostic: {
        code: stale ? 'no_status_received' : 'ok',
        message: stale ? `No status update in ${ageSec}s` : null,
        lastLatencyMs: null,
      },
    };
  }

  return { telemetry, workflow, hms, materials, bridgeHealth };
}

// ─── Workflow helpers ───────────────────────────────────────────────────────

interface PrintTransition {
  type: PrinterWorkflowEvent['type'];
  reason: PrinterWorkflowEvent['reason'];
}

const mapPrintTransition = (
  from: PrinterLifecycleState,
  to: PrinterLifecycleState,
): PrintTransition | null => {
  if (from === to) return null;
  // running entry
  if (to === 'printing' && from !== 'printing' && from !== 'paused') {
    return { type: 'print.started', reason: null };
  }
  if (to === 'printing' && from === 'paused') {
    return { type: 'print.resumed', reason: null };
  }
  if (to === 'paused') {
    return { type: 'print.paused', reason: 'unknown' };
  }
  if (to === 'finished' && (from === 'printing' || from === 'paused' || from === 'finishing')) {
    return { type: 'print.finished', reason: null };
  }
  if (to === 'failed') {
    return { type: 'print.failed', reason: 'unknown' };
  }
  return null;
};

const buildMaterialEvent = (
  envelope: PrinterEventEnvelope,
  type: PrinterMaterialEvent['type'],
  unit: number,
  slot: number,
  previous: MaterialIdentity | null,
  current: MaterialIdentity | null,
  trayNow: number | null,
): PrinterMaterialEvent => ({
  ...envelope,
  kind: 'material',
  type,
  amsUnit: Number.isFinite(unit) ? unit : null,
  slot: Number.isFinite(slot) ? slot : null,
  isActiveTray: trayNow !== null && trayNow === unit * 4 + slot,
  current,
  previous,
  suggestions: [],
});

const materialIdentityEqual = (a: MaterialIdentity, b: MaterialIdentity): boolean =>
  a.material === b.material &&
  a.colorHex === b.colorHex &&
  a.vendorProfileId === b.vendorProfileId &&
  a.rfidTagUid === b.rfidTagUid &&
  a.vendorTrayUuid === b.vendorTrayUuid;

const ageInSeconds = (lastSeen: string, now: string): number | null => {
  const a = Date.parse(lastSeen);
  const b = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
};

// ─── B5: Top-Level-Mapper für Phase D ───────────────────────────────────────

import { decodeHomeFlag } from './bambu-bit-decoders';
import { decodeStat, decodeFun } from './bambu-hex-decoders';
import { decodeExtruderInfo } from './bambu-h2-device-decoder';

export function mapHomeFlag(block: BambuPrintBlock): {
  doorOpen?: boolean;
  filamentTangle?: boolean;
  homeFlagRaw?: number;
} {
  if (block.home_flag === undefined || block.home_flag === null) return {};
  const flags = decodeHomeFlag(block.home_flag);
  return {
    doorOpen: flags.doorOpen,
    filamentTangle: flags.filamentTangle,
    homeFlagRaw: flags.raw,
  };
}

export function mapStat(block: BambuPrintBlock): { statRaw?: number } {
  if (block.stat === undefined || block.stat === null) return {};
  return { statRaw: decodeStat(block.stat).raw };
}

// OBS-5: Bit-Position 0x00002000 noch nicht final verifiziert. Bei realen
// 12-stelligen fun-Werten ggf. unzuverlässig. Hardware-Trace nötig (K13).
export function mapFun(block: BambuPrintBlock): {
  developerModeActive?: boolean;
  funRaw?: number;
} {
  if (block.fun === undefined || block.fun === null) return {};
  const f = decodeFun(block.fun);
  return {
    developerModeActive: f.developerModeBitSet,
    funRaw: f.raw,
  };
}

export function mapXcamStatus(block: BambuPrintBlock): {
  xcamFirstLayerInspector?: boolean;
  xcamSpaghettiDetector?: boolean;
  xcamBuildplateMarkerDetector?: boolean;
  xcamPrintHalt?: boolean;
  xcamPrintingMonitor?: boolean;
  xcamAllowSkipParts?: boolean;
  xcamHaltPrintSensitivity?: string;
} {
  const x = block.xcam;
  if (!x) return {};
  return {
    xcamFirstLayerInspector: x.first_layer_inspector,
    xcamSpaghettiDetector: x.spaghetti_detector,
    xcamBuildplateMarkerDetector: x.buildplate_marker_detector,
    xcamPrintHalt: x.print_halt,
    xcamPrintingMonitor: x.printing_monitor,
    xcamAllowSkipParts: x.allow_skip_parts,
    xcamHaltPrintSensitivity: x.halt_print_sensitivity,
  };
}

export function mapIpcamStatus(block: BambuPrintBlock): {
  ipcamRecord?: boolean;
  ipcamTimelapse?: boolean;
  ipcamResolution?: string;
  ipcamModeBits?: number;
  ipcamTutkServer?: string;
  rtspUrl?: string;
} {
  const i = block.ipcam;
  if (!i) return {};
  return {
    ipcamRecord: i.ipcam_record === 'enable',
    ipcamTimelapse: i.timelapse === 'enable',
    ipcamResolution: i.resolution,
    ipcamModeBits: i.mode_bits ?? i.mode_bit,
    ipcamTutkServer: i.tutk_server,
    rtspUrl: i.rtsp_url,
  };
}

export function mapUpgradeState(block: BambuPrintBlock): {
  upgradeStatus?: string;
  upgradeProgress?: number;
  upgradeNewVersionState?: number;
  upgradeNewVerList?: Array<{ name: string; swVer?: string; hwVer?: string; flag?: number }>;
  firmwareModules?: Array<{ name: string; swVer?: string; hwVer?: string; serialNumber?: string; loaderVer?: string }>;
} {
  const u = block.upgrade_state;
  if (!u) return {};
  const progressNum = u.progress !== undefined ? Number(u.progress) : undefined;
  return {
    upgradeStatus: u.status,
    upgradeProgress: progressNum !== undefined && Number.isFinite(progressNum) ? progressNum : undefined,
    upgradeNewVersionState: u.new_version_state,
    upgradeNewVerList: Array.isArray(u.new_ver_list)
      ? u.new_ver_list.map((v) => ({
          name: v.name,
          swVer: v.new_ver,
          hwVer: v.cur_ver,
          flag: v.flag,
        }))
      : undefined,
    firmwareModules: Array.isArray(u.module)
      ? u.module.map((m) => ({
          name: m.name,
          swVer: m.sw_ver,
          hwVer: m.hw_ver,
          serialNumber: m.sn,
          loaderVer: m.loader_ver,
        }))
      : undefined,
  };
}

// OBS-1: isZero-Flag macht 0/0 nicht von 'fehlt' unterscheidbar.
// OBS-6: TS- und Rust-Decoder liefern aktuell unterschiedliche Werte.
// Phase E klärt nach Hardware-Trace.
export function mapH2Device(devicePayload: unknown): {
  nozzleTemp?: number;
  nozzleTargetTemp?: number;
  nozzleTemp2?: number;
  nozzleTargetTemp2?: number;
  chamberTemp?: number;
} {
  if (!devicePayload || typeof devicePayload !== 'object') return {};
  const d = devicePayload as {
    extruder?: { info?: unknown };
    ctc?: { info?: { temp?: unknown } };
  };
  const result: {
    nozzleTemp?: number;
    nozzleTargetTemp?: number;
    nozzleTemp2?: number;
    nozzleTargetTemp2?: number;
    chamberTemp?: number;
  } = {};

  const info = d.extruder?.info;
  if (info) {
    const decoded = decodeExtruderInfo(info);
    if (decoded[0] && !decoded[0].isZero) {
      result.nozzleTemp = decoded[0].current;
      result.nozzleTargetTemp = decoded[0].target;
    }
    if (decoded[1] && !decoded[1].isZero) {
      result.nozzleTemp2 = decoded[1].current;
      result.nozzleTargetTemp2 = decoded[1].target;
    }
  }

  // H2D/H2C-Familie: Chamber-Temp in device.ctc.info.temp
  // (statt im üblichen print.chamber_temper das hier nicht gesetzt wird).
  // Spec: docs/bridge/bambu-mqtt-function-map.md §1.3
  const ctcTemp = d.ctc?.info?.temp;
  if (typeof ctcTemp === 'number' && Number.isFinite(ctcTemp)) {
    result.chamberTemp = ctcTemp;
  }

  return result;
}

// B10: print.online → ahb/rfid
export function mapPrintOnline(block: BambuPrintBlock): {
  ahbOnline?: boolean;
  rfidOnline?: boolean;
} {
  const o = block.online;
  if (!o || typeof o !== 'object') return {};
  return {
    ahbOnline: typeof o.ahb === 'boolean' ? o.ahb : undefined,
    rfidOnline: typeof o.rfid === 'boolean' ? o.rfid : undefined,
  };
}

// ─── Internal exports for tests ─────────────────────────────────────────────

export const __test = {
  formatHmsCode,
  mapHmsSeverity: getHmsSeverity,
  mapHmsModule: getHmsModule,
  fanToPercent,
  wifiToDbm,
  mapLifecycle,
  stageName,
  extractPrintBlock,
  normalizeColorHex,
  collectTrayMap,
  buildMaterialIdentity,
};

// ─── HMS-Helper Re-Exports ──────────────────────────────────────────────────
// Konsumenten können Helper direkt aus dem Mapper importieren.
export { formatHmsCode, buildHmsWikiUrl, getHmsModule, getHmsSeverity };
export {
  getHmsDescription,
  enrichHmsEntry,
  mapHmsArray,
} from './bambu-hms-enricher';
export type { EnrichedHmsEntry } from './bambu-hms-enricher';
