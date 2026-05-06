/**
 * Vafrum Core — PrinterStatus
 *
 * Single Source of Truth für den Drucker-Status. Wird von allen
 * Bridges (Tauri, headless mqtt-client), allen Adaptern (bambu, marlin,
 * octoprint, moonraker), den Gateway-Services und dem Frontend
 * gleichermaßen verwendet.
 *
 * Schema gespiegelt 1:1 vom historischen vafrum-core-api/src/gateway/printer.gateway.ts,
 * weil dort die echte Production-Pipeline lief. Erweiterung um modelClass/modelFamily
 * (K15/A7 — Modell-Auto-Match aus Seriennummer-Präfix).
 *
 * Bei Erweiterungen IMMER hier erweitern — nicht in lokalen Interfaces.
 */

// ─── Network ────────────────────────────────────────────────────────────────

export interface NetInterface {
  type?: string;
  ip?: string;
  mask?: string;
  gateway?: string;
  mac?: string;
}

export interface NetInfo {
  conf?: string;
  info?: NetInterface[];
}

// ─── Firmware / Upgrade ─────────────────────────────────────────────────────

export interface UpgradeVersion {
  name: string;
  swVer?: string;
  hwVer?: string;
  flag?: number;
}

export interface FirmwareModule {
  name: string;
  swVer?: string;
  hwVer?: string;
  serialNumber?: string;
  loaderVer?: string;
}

// ─── AMS (Automatic Material System) ────────────────────────────────────────

export interface AmsUnit {
  id: number;
  temp: number;
  humidity?: number;
  humidityIndex?: number;
  /** Düsen-Index dieser AMS-Unit bei Dual-Nozzle (H2D/H2C): 0=links, 1=rechts.
   *  Decodiert aus device.extruder.info[].snow (>> 4 = ams_id, & 0xF = tray_idx).
   *  Reference §3.6 + Z. 1066-1068. */
  nozzle?: number;
}

export interface AmsTray {
  id: number;
  unitId: number;
  slot: number;
  type: string;
  color: string;
  name: string;
  remain: number;
  k: number;
  temp: string;
  trayUuid?: string;
  tagUid?: string;
  trayInfoIdx?: string;
  trayWeight?: number;
  nozzleTempMin?: number;
  nozzleTempMax?: number;
  bedTemp?: number | null;
  xcamInfo?: string | null;
  humidityRaw?: number | null;
  dryTime?: number | null;
  trayPre?: number | null;
  trayTar?: number | null;
}

export interface AmsStatus {
  humidity?: number;
  trayNow?: number;
  units?: AmsUnit[];
  trays?: AmsTray[];
  amsExistBits?: number;
  trayExistBits?: number;
  trayIsBblBits?: number;
  trayReadDoneBits?: number;
}

// ─── External Spool ─────────────────────────────────────────────────────────

export interface ExternalSpool {
  id?: number;
  type: string;
  color: string;
  name: string;
  remain?: number;
  k?: number;
  nozzleTempMin?: number;
  nozzleTempMax?: number;
  trayInfoIdx?: string;
  tagUid?: string;
  trayWeight?: number;
}

// ─── HMS ────────────────────────────────────────────────────────────────────

export interface HmsEntry {
  attr: number;
  code: number;
  action?: number;
  timestamp?: string;
}

// ─── Live Cost ──────────────────────────────────────────────────────────────

export interface LiveCost {
  electricityCost: number;
  filamentCost: number;
  wearCost: number;
  totalCost: number;
  energyWh: number;
  costPerHour: number;
}

// ─── Printer Status ─────────────────────────────────────────────────────────

export interface PrinterStatus {
  printerId: string;
  serialNumber: string;
  online: boolean;
  lastSeen: Date;
  gcodeState: string;
  printProgress: number;
  remainingTime: number;
  currentFile?: string;
  layer?: number;
  totalLayers?: number;
  nozzleTemp: number;
  nozzleTargetTemp: number;
  nozzleTemp2?: number;
  nozzleTargetTemp2?: number;
  bedTemp: number;
  bedTargetTemp: number;
  chamberTemp?: number;
  wifiSignal?: number;
  partFanSpeed?: number;
  auxFanSpeed?: number;
  chamberFanSpeed?: number;
  speedLevel?: number;
  speedMagnification?: number;
  chamberLight?: boolean;
  workLight?: boolean;
  heatbedLight?: boolean;
  cameraUrl?: string;
  ams?: AmsStatus;
  externalSpool?: ExternalSpool;
  externalSpools?: ExternalSpool[];
  printError?: number;
  printErrorCode?: string;
  printStage?: number;
  hms?: HmsEntry[];
  liveCost?: LiveCost;

  // K15 / Phase A7: automatisch aus Seriennummer-Präfix gesetzt, kein User-Override
  modelClass?: string | null;
  modelFamily?: string | null;

  // §1.1 Online / Lifecycle
  ahbOnline?: boolean;
  rfidOnline?: boolean;

  // §1.2 erweiterter Druck-Status
  mcPrintSubStage?: number;
  stgCur?: number;
  printType?: string;
  failReason?: string;
  gcodeStartTime?: string;
  gcodeFilePreparePercent?: number;
  sObj?: number[];
  amsMappingStatus?: number[];
  mcPrintErrorCode?: number;
  subtaskId?: string;
  projectId?: string;
  taskId?: string;

  // §1.4 Lüfter
  heatbreakFanSpeed?: number;

  // §1.6 Beleuchtung — chamberLight2
  chamberLight2?: boolean;

  // §1.9 Hardware-Bits und Flags
  doorOpen?: boolean;
  filamentTangle?: boolean;
  sdAbnormal?: boolean;
  amsAutoSwitch?: boolean;
  hwSwitchState?: number;
  developerModeActive?: boolean;
  nozzleDiameter?: number;
  nozzleType?: string;
  sdcardPresent?: boolean;
  auxPartFan?: number;
  homeFlagRaw?: number;
  statRaw?: number;
  funRaw?: number;

  // §1.9 Network
  netInfo?: NetInfo;

  // §1.9 Camera (ipcam)
  ipcamRecord?: boolean;
  ipcamTimelapse?: boolean;
  ipcamResolution?: string;
  ipcamModeBits?: number;
  ipcamTutkServer?: string;

  // §1.9 XCam
  xcamFirstLayerInspector?: boolean;
  xcamSpaghettiDetector?: boolean;
  xcamBuildplateMarkerDetector?: boolean;
  xcamPrintHalt?: boolean;
  xcamPrintingMonitor?: boolean;
  xcamAllowSkipParts?: boolean;
  xcamHaltPrintSensitivity?: string;

  // §1.10 Firmware / Upgrade
  upgradeStatus?: string;
  upgradeProgress?: number;
  upgradeNewVersionState?: number;
  upgradeNewVerList?: UpgradeVersion[];
  firmwareModules?: FirmwareModule[];
}

// ─── Printer Commands ───────────────────────────────────────────────────────

export type PrinterCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'light'; on: boolean }
  | { type: 'chamberLight'; on: boolean }
  | { type: 'workLight'; on: boolean }
  | { type: 'heatbedLight'; on: boolean }
  | { type: 'partFan'; speed: number }
  | { type: 'auxFan'; speed: number }
  | { type: 'chamberFan'; speed: number }
  | { type: 'nozzleTemp'; temp: number }
  | { type: 'nozzle2Temp'; temp: number }
  | { type: 'bedTemp'; temp: number }
  | { type: 'speedLevel'; level: 1 | 2 | 3 | 4 }
  | { type: 'loadFilament'; trayId: number }
  | { type: 'unloadFilament' }
  | { type: 'calibration'; calibrationType: 'bed_level' | 'vibration' | 'flow' | 'full' | 'home' }
  | { type: 'timelapse'; enabled: boolean }
  | { type: 'gcode'; gcode: string }
  | { type: 'gcodeFile'; fileName: string }
  | {
      type: 'projectFile';
      param: string;
      file?: string;
      url?: string;
      md5?: string;
      bedType?: string;
      timelapse?: boolean;
      bedLevelling?: boolean;
      flowCali?: boolean;
      vibrationCali?: boolean;
      layerInspect?: boolean;
      useAms?: boolean;
      amsMapping?: number[];
    }
  | { type: 'move'; axis: 'X' | 'Y' | 'Z'; distance: number; speed?: number }
  | {
      type: 'amsFilamentSetting';
      amsId: number;
      trayId: number;
      trayColor: string;
      nozzleTempMin: number;
      nozzleTempMax: number;
      trayType: string;
      trayInfoIdx?: string;
    }
  | { type: 'amsUserSetting'; amsId: number; startupReadOption: boolean; trayReadOption: boolean }
  | { type: 'amsDrying'; amsId: number; temp: number; duration: number; mode: 0 | 1 }
  | { type: 'amsControl'; param: 'resume' | 'pause' | 'reset' }
  | { type: 'amsGetRfid'; amsId: number; slotId: number }
  | { type: 'ipcamRecord'; control: 'enable' | 'disable' }
  | { type: 'ipcamTimelapse'; control: 'enable' | 'disable' }
  | { type: 'setAccessories'; nozzleDiameter: number; nozzleType: 'stainless_steel' | 'hardened_steel' | 'tungsten_carbide' }
  | { type: 'getAccessories' }
  | { type: 'getAccessCode' }
  | { type: 'skipObjects'; objList: number[] }
  | { type: 'xcamControl'; moduleName: 'first_layer_inspector' | 'spaghetti_detector' | 'buildplate_marker_detector' | 'pileup_detector' | 'clump_detector' | 'printing_monitor' | 'airprint_detector'; control: boolean; printHalt?: boolean }
  | { type: 'printOption'; soundEnable?: boolean; autoRecovery?: boolean; filamentTangleDetect?: boolean; nozzleBlobDetect?: boolean; airPrintDetect?: boolean }
  | { type: 'buzzerCtrl'; mode: 0 | 1 | 2 }
  | { type: 'setAirduct'; modeId: number; submode: number }
  | { type: 'ledFlashing'; ledNode: string; onTime: number; offTime: number }

  // Firmware Upgrade (Function Map §2.8) — explizit blocked, niemals auslösen
  | { type: 'upgradeStart'; _blocked: true }
  | { type: 'upgradeConfirm'; _blocked: true }
  | { type: 'upgradeConsistencyConfirm'; _blocked: true };
