/**
 * Vafrum Core — Bambu Status Mapper (Phase D1)
 *
 * Zentraler Mapper Bambu-Push-Status → PrinterStatus. Wird von
 * Cloud-MQTT, Headless mqtt-client und der JS-Bridge gleichermaßen
 * aufgerufen, damit alle drei Pfade dieselbe Coverage und dasselbe
 * Schema liefern.
 *
 * Coverage: alle Felder aus shared/interfaces/printer-status.ts die
 * aus dem Push-Status-Payload ableitbar sind, inklusive aller B1-
 * Erweiterungen (homeFlag, stat, fun, xcam, ipcam, upgrade, ahb/rfid,
 * H2-Multi-Extruder via devicePayload, AMS, HMS, modelClass/Family).
 */

import type { PrinterStatus, AmsStatus, AmsUnit, AmsTray, HmsEntry, ExternalSpool } from '../interfaces/printer-status';
import type { BambuPrintBlock, BambuAmsBlock } from './bambu-event-mapper';
import {
  mapHomeFlag,
  mapStat,
  mapFun,
  mapXcamStatus,
  mapIpcamStatus,
  mapUpgradeState,
  mapH2Device,
  mapPrintOnline,
} from './bambu-event-mapper';
import { detectModelBySerial } from './bambu-serial-prefix';

export interface BuildPrinterStatusContext {
  /** Optionaler Modellname falls aus DB schon bekannt — überschreibt Detection-Modell nicht direkt im PrinterStatus (kein Top-Level model-Feld), wird aber für mögliche modelClass/Family-Override genutzt wenn Detection unknown bleibt. */
  model?: string | null;
  /** Optionaler PrinterId falls abweichend vom serial. Default: serial. */
  printerId?: string;
}

/**
 * Baut PrinterStatus aus Bambu-Push-Status-Payload.
 *
 * @param serialNumber  Drucker-Serial (Pflicht; treibt modelClass/Family-Detection)
 * @param block         BambuPrintBlock aus payload.print
 * @param devicePayload Top-Level-payload.print.device (für H2-extruder.info)
 * @param ctx           Optionaler Kontext
 */
export function buildPrinterStatusFromBambuReport(
  serialNumber: string,
  block: BambuPrintBlock,
  devicePayload?: unknown,
  ctx?: BuildPrinterStatusContext,
): PrinterStatus {
  const detected = detectModelBySerial(serialNumber);
  const modelClass: string | null =
    detected.class !== 'unknown' ? detected.class : null;
  const modelFamily: string | null =
    detected.family !== 'unknown' ? detected.family : null;

  const printOnline = mapPrintOnline(block);

  // ─── Temperaturen (mit H2D-Override) ─────────────────────────────────────
  let nozzleTemp = numOrZero(block.nozzle_temper);
  let nozzleTargetTemp = numOrZero(block.nozzle_target_temper);
  let nozzleTemp2: number | undefined;
  let nozzleTargetTemp2: number | undefined;
  let chamberTempH2: number | undefined;
  if (devicePayload) {
    const h2 = mapH2Device(devicePayload);
    if (h2.nozzleTemp !== undefined) nozzleTemp = h2.nozzleTemp;
    if (h2.nozzleTargetTemp !== undefined) nozzleTargetTemp = h2.nozzleTargetTemp;
    if (h2.nozzleTemp2 !== undefined) nozzleTemp2 = h2.nozzleTemp2;
    if (h2.nozzleTargetTemp2 !== undefined) nozzleTargetTemp2 = h2.nozzleTargetTemp2;
    if (h2.chamberTemp !== undefined) chamberTempH2 = h2.chamberTemp;
  }

  const lights = parseLightsReport(block.lights_report);
  const homeFlag = mapHomeFlag(block);
  const statRaw = mapStat(block).statRaw;
  const fun = mapFun(block);
  const xcam = mapXcamStatus(block);
  const ipcam = mapIpcamStatus(block);
  const upgrade = mapUpgradeState(block);

  const netInfo = block.net
    ? {
        conf: block.net.conf,
        info: block.net.info?.map((i) => ({
          type: i.type,
          ip: i.ip,
          mask: i.mask,
          gateway: i.gateway,
          mac: i.mac,
        })),
      }
    : undefined;

  const hms = mapHmsRaw(block.hms);

  return {
    printerId: ctx?.printerId ?? serialNumber,
    serialNumber,
    online: true,
    lastSeen: new Date(),

    gcodeState: typeof block.gcode_state === 'string' ? block.gcode_state : 'IDLE',
    printProgress: numOrZero(block.mc_percent),
    remainingTime: numOrZero(block.mc_remaining_time),
    currentFile: strOrUndef(block.subtask_name) ?? strOrUndef(block.gcode_file),
    layer: numOrUndef(block.layer_num),
    totalLayers: numOrUndef(block.total_layer_num),

    nozzleTemp,
    nozzleTargetTemp,
    nozzleTemp2,
    nozzleTargetTemp2,
    bedTemp: numOrZero(block.bed_temper),
    bedTargetTemp: numOrZero(block.bed_target_temper),
    chamberTemp: chamberTempH2 ?? numOrUndef(block.chamber_temper),

    wifiSignal: parseIntOrUndef(block.wifi_signal),

    partFanSpeed: numOrUndef(block.cooling_fan_speed),
    auxFanSpeed: numOrUndef(block.big_fan1_speed),
    chamberFanSpeed: numOrUndef(block.big_fan2_speed),
    heatbreakFanSpeed: numOrUndef(block.heatbreak_fan_speed),

    speedLevel: numOrUndef(block.spd_lvl),
    speedMagnification: numOrUndef(block.spd_mag),

    chamberLight: lights.chamberLight,
    chamberLight2: lights.chamberLight2,
    workLight: lights.workLight,
    heatbedLight: lights.heatbedLight,

    ams: mapAmsBlock(block.ams),
    externalSpools: mapVirSlots(block.vir_slot),

    printError: numOrUndef(block.print_error),
    printStage: numOrUndef(block.mc_print_stage),
    hms,

    modelClass,
    modelFamily,

    // §1.1
    ahbOnline: printOnline.ahbOnline,
    rfidOnline: printOnline.rfidOnline,

    // §1.2
    mcPrintSubStage: numOrUndef(block.mc_print_sub_stage),
    stgCur: numOrUndef(block.stg_cur),
    printType: strOrUndef(block.print_type),
    failReason: strOrUndef(block.fail_reason),
    gcodeStartTime: strOrUndef(block.gcode_start_time),
    gcodeFilePreparePercent: numOrUndef(block.gcode_file_prepare_percent),
    sObj: Array.isArray(block.s_obj) ? (block.s_obj as number[]) : undefined,
    amsMappingStatus: Array.isArray(block.ams_mapping) ? (block.ams_mapping as number[]) : undefined,
    mcPrintErrorCode: numOrUndef(block.mc_print_error_code),
    subtaskId: strOrUndef(block.subtask_id),
    projectId: strOrUndef(block.project_id),
    taskId: strOrUndef(block.task_id),

    // §1.9 Hardware-Bits
    doorOpen: homeFlag.doorOpen,
    filamentTangle: homeFlag.filamentTangle,
    homeFlagRaw: homeFlag.homeFlagRaw,
    statRaw,
    funRaw: fun.funRaw,
    developerModeActive: fun.developerModeActive,
    hwSwitchState: numOrUndef(block.hw_switch_state),
    nozzleDiameter: numOrUndef(block.nozzle_diameter),
    nozzleType: strOrUndef(block.nozzle_type),
    sdcardPresent: typeof block.sdcard === 'boolean' ? block.sdcard : undefined,
    auxPartFan: numOrUndef(block.aux_part_fan),

    netInfo,

    // §1.9 ipcam
    ipcamRecord: ipcam.ipcamRecord,
    ipcamTimelapse: ipcam.ipcamTimelapse,
    ipcamResolution: ipcam.ipcamResolution,
    ipcamModeBits: ipcam.ipcamModeBits,
    ipcamTutkServer: ipcam.ipcamTutkServer,
    cameraUrl: ipcam.rtspUrl,

    // §1.9 xcam
    xcamFirstLayerInspector: xcam.xcamFirstLayerInspector,
    xcamSpaghettiDetector: xcam.xcamSpaghettiDetector,
    xcamBuildplateMarkerDetector: xcam.xcamBuildplateMarkerDetector,
    xcamPrintHalt: xcam.xcamPrintHalt,
    xcamPrintingMonitor: xcam.xcamPrintingMonitor,
    xcamAllowSkipParts: xcam.xcamAllowSkipParts,
    xcamHaltPrintSensitivity: xcam.xcamHaltPrintSensitivity,

    // §1.10 upgrade
    upgradeStatus: upgrade.upgradeStatus,
    upgradeProgress: upgrade.upgradeProgress,
    upgradeNewVersionState: upgrade.upgradeNewVersionState,
    upgradeNewVerList: upgrade.upgradeNewVerList,
    firmwareModules: upgrade.firmwareModules,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function numOrZero(v: unknown): number {
  return numOrUndef(v) ?? 0;
}

function strOrUndef(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseIntOrUndef(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : undefined;
  if (typeof v !== 'string') return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

function parseLightsReport(
  lr: Array<{ node: string; mode: string }> | undefined,
): {
  chamberLight?: boolean;
  chamberLight2?: boolean;
  workLight?: boolean;
  heatbedLight?: boolean;
} {
  if (!Array.isArray(lr)) return {};
  const out: {
    chamberLight?: boolean;
    chamberLight2?: boolean;
    workLight?: boolean;
    heatbedLight?: boolean;
  } = {};
  for (const e of lr) {
    if (!e?.node || typeof e.mode !== 'string') continue;
    if (e.mode !== 'on' && e.mode !== 'off' && e.mode !== 'flashing') continue;
    const value = e.mode !== 'off';
    if (e.node === 'chamber_light') out.chamberLight = value;
    else if (e.node === 'chamber_light2') out.chamberLight2 = value;
    else if (e.node === 'work_light') out.workLight = value;
    else if (e.node === 'heatbed_light') out.heatbedLight = value;
  }
  return out;
}

function mapAmsBlock(ams: BambuAmsBlock | undefined): AmsStatus | undefined {
  if (!ams || typeof ams !== 'object') return undefined;
  const units: AmsUnit[] = [];
  const trays: AmsTray[] = [];
  if (Array.isArray(ams.ams)) {
    for (const u of ams.ams) {
      const unitId = parseIntOrUndef(u.id) ?? 0;
      const unitTemp = parseIntOrUndef(u.temp) ?? 0;
      const unitHumidity = parseIntOrUndef(u.humidity);
      units.push({
        id: unitId,
        temp: unitTemp,
        humidity: unitHumidity,
        humidityIndex: u.humidity_raw,
      });
      if (Array.isArray(u.tray)) {
        for (let slotIdx = 0; slotIdx < u.tray.length; slotIdx++) {
          const t = u.tray[slotIdx];
          if (!t) continue;
          const trayId = parseIntOrUndef(t.id) ?? slotIdx;
          trays.push({
            id: trayId,
            unitId,
            slot: slotIdx,
            type: strOrUndef(t.tray_type) ?? '',
            color: strOrUndef(t.tray_color) ?? '',
            name: strOrUndef(t.tray_id_name) ?? strOrUndef(t.tray_sub_brands) ?? '',
            remain: numOrZero(t.remain),
            k: numOrZero(t.k),
            temp: '',
            trayUuid: strOrUndef(t.tray_uuid),
            tagUid: strOrUndef(t.tag_uid),
            trayInfoIdx: strOrUndef(t.tray_info_idx),
            trayWeight: numOrUndef(t.tray_weight),
            nozzleTempMin: numOrUndef(t.nozzle_temp_min),
            nozzleTempMax: numOrUndef(t.nozzle_temp_max),
            bedTemp: numOrUndef(t.bed_temp) ?? null,
            xcamInfo: strOrUndef(t.xcam_info) ?? null,
          });
        }
      }
    }
  }
  return {
    trayNow: parseIntOrUndef(ams.tray_now),
    units,
    trays,
    amsExistBits: parseIntOrUndef(ams.ams_exist_bits),
    trayExistBits: parseIntOrUndef(ams.tray_exist_bits),
    trayIsBblBits: ams.tray_is_bbl_bits,
    trayReadDoneBits: ams.tray_read_done_bits,
  };
}

function mapHmsRaw(
  hms: Array<{ attr: number; code: number; action?: number; timestamp?: number }> | undefined,
): HmsEntry[] | undefined {
  if (!Array.isArray(hms)) return undefined;
  return hms.map((e) => ({
    attr: e.attr,
    code: e.code,
    action: e.action,
    timestamp: typeof e.timestamp === 'number' ? new Date(e.timestamp).toISOString() : undefined,
  }));
}

/**
 * Mappt H-Familie vir_slot[] auf ExternalSpool[].
 * vir_slot.id 254 = linke Düse, 253 = rechte Düse (H2D Dual-Nozzle).
 * Leere Spulen (tray_color all-zeros, tray_type leer) werden ignoriert.
 */
function mapVirSlots(virSlots: unknown): ExternalSpool[] | undefined {
  if (!Array.isArray(virSlots) || virSlots.length === 0) return undefined;
  const out: ExternalSpool[] = [];
  for (const v of virSlots) {
    if (!v || typeof v !== 'object') continue;
    const slot = v as Record<string, unknown>;
    const color = typeof slot.tray_color === 'string' ? slot.tray_color : '';
    const type = typeof slot.tray_type === 'string' ? slot.tray_type : '';
    if ((!color || /^0+$/.test(color)) && !type) continue;
    const idNum = parseIntOrUndef(slot.id);
    out.push({
      id: idNum,
      type,
      color,
      name: typeof slot.tray_id_name === 'string' ? slot.tray_id_name : '',
      remain: typeof slot.remain === 'number' ? slot.remain : numOrZero(slot.remain),
      k: typeof slot.k === 'number' ? slot.k : numOrZero(slot.k),
      nozzleTempMin: parseIntOrUndef(slot.nozzle_temp_min),
      nozzleTempMax: parseIntOrUndef(slot.nozzle_temp_max),
      trayInfoIdx: typeof slot.tray_info_idx === 'string' ? slot.tray_info_idx : undefined,
      tagUid: typeof slot.tag_uid === 'string' ? slot.tag_uid : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}
