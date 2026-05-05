/**
 * Vendor-Neutral Printer Event Schema
 *
 * Quelle der Wahrheit für alle Drucker-Events, die zwischen Bridge,
 * Backend (vafrum-core-api), Frontend (vafrum-core-web), iOS-App und
 * externen Integrationen ausgetauscht werden.
 *
 * Designprinzipien (siehe docs/bridge/bambu-mqtt-function-map.md):
 *  - Hersteller-neutral. Bambu/Prusa/Klipper-spezifische Rohdaten dürfen
 *    nur über das optionale `raw`/`sourcePayload`-Feld mitgegeben werden.
 *  - Jeder Event identifiziert eindeutig: Drucker (printerId + serialNumber),
 *    den lokalen Bridge/Cloud-Endpunkt (bridgeId), die Quelle (source),
 *    den Workspace/Tenant (workspaceId) und einen Zeitstempel.
 *  - Commands tragen einen Audit-Footprint (requestedBy, endpoint,
 *    authorityCheck, auditSeverity) – siehe Abschnitt 5 der Function Map.
 */

// ─── Gemeinsame Bausteine ───────────────────────────────────────────────────

/** Wo der Event entstanden ist. */
export type EventSource =
  | 'bridge.lan'      // Bridge (apps/vafrum-bridge / vafrum-mqtt-client) via LAN-MQTT
  | 'bridge.cloud'    // Bridge via Cloud-MQTT
  | 'backend.cloud'   // vafrum-core-api spricht Cloud-MQTT direkt
  | 'backend.derived' // Aus anderen Daten abgeleitet (z. B. Watchdog, Diff)
  | 'system.test'     // Synthetischer Event aus Tests/Mock
  | 'unknown';

/** Hersteller-/Adapter-Familie. Erweitert sich mit neuen Adaptern. */
export type PrinterVendor =
  | 'bambu'
  | 'prusa'
  | 'klipper'
  | 'bambu-h2d'   // Spezialisierung wegen abweichendem device-Format
  | 'generic'
  | 'unknown';

/**
 * Optionaler Roh-Payload, falls Konsumenten Hersteller-Spezifika brauchen.
 * Strukturlos, damit das Schema nicht an einen Hersteller gebunden ist.
 * Konsumenten dürfen sich auf das Vorhandensein NICHT verlassen.
 */
export interface RawSourcePayload {
  vendor: PrinterVendor;
  /** Topic / Stream / Endpoint, von dem der Payload stammt. */
  channel?: string;
  /** Hersteller-eigene Sequenznummer (z. B. Bambu sequence_id). */
  sourceSequenceId?: string | number;
  /** Originalnachricht, ungefiltert. */
  payload: unknown;
}

/**
 * Gemeinsamer Header für ALLE Events und Commands.
 * Definiert Adressierung, Routing und Tenant-Zuordnung.
 */
export interface PrinterEventEnvelope {
  /** Stabiler interner Drucker-Identifier (UUID). */
  printerId: string;
  /** Hersteller-Seriennummer / eindeutige Hardware-ID. */
  serial: string;
  /** Workspace/Tenant-Zugehörigkeit (Multi-Tenant). */
  workspaceId: string;
  /** ID der Bridge, die den Event erzeugt hat. `null` = Backend-direkt. */
  bridgeId: string | null;
  /** Wer/Was den Event erzeugt hat. */
  source: EventSource;
  /** Hersteller-Familie (für UI-Spezialfälle). */
  vendor: PrinterVendor;
  /** ISO-8601 Zeitpunkt. */
  timestamp: string;
  /** Monoton steigende Eventfolge je Drucker (für Out-of-Order-Erkennung). */
  sequence?: number;
  /** Optionaler Trace-/Korrelations-Identifier. */
  correlationId?: string;
  /** Optionaler Roh-Payload (Hersteller-spezifisch, nicht typisiert). */
  raw?: RawSourcePayload;
}

// ─── Telemetrie ─────────────────────────────────────────────────────────────

/** Lifecycle-Status des Druckers (vendor-neutral). */
export type PrinterLifecycleState =
  | 'online'
  | 'offline'
  | 'idle'
  | 'preparing'
  | 'printing'
  | 'paused'
  | 'finishing'
  | 'finished'
  | 'failed'
  | 'error'
  | 'maintenance'
  | 'updating'
  | 'unknown';

/** Beheizte/aktive Komponente. */
export type ThermalComponent =
  | 'nozzle'
  | 'nozzle2'
  | 'bed'
  | 'chamber'
  | 'ams';

export interface ThermalReading {
  component: ThermalComponent;
  /** Aktuelle Temperatur in °C, `null` wenn nicht verfügbar. */
  current: number | null;
  /** Zieltemperatur in °C, `null` wenn nicht heizt. */
  target: number | null;
}

/** Lüfter-Auslastung in 0–100 %. */
export type FanChannel = 'part' | 'aux' | 'chamber' | 'aux2' | 'heatbreak';

export interface FanReading {
  channel: FanChannel;
  /** 0–100 %, `null` wenn nicht verfügbar. */
  speedPercent: number | null;
}

/** Lichtquelle. */
export type LightChannel =
  | 'chamber'
  | 'chamber2'
  | 'work'
  | 'heatbed';

export interface LightReading {
  channel: LightChannel;
  on: boolean;
}

/** Druckfortschritt. */
export interface PrintProgress {
  /** 0–100 %, `null` wenn kein aktiver Druck. */
  percent: number | null;
  /** Verbleibende Zeit in Sekunden. */
  remainingSeconds: number | null;
  /** Aktuelle Schicht (1-basiert). */
  currentLayer: number | null;
  totalLayers: number | null;
  /** Anzeigename des Jobs / Datei. */
  jobName: string | null;
  /** Stabiler Job-/PrintJob-Identifier (Vafrum-intern, falls bekannt). */
  jobId: string | null;
}

/** Netzwerk-Telemetrie. */
export interface NetworkSignal {
  /** WiFi-Signal in dBm, `null` falls Ethernet/unbekannt. */
  wifiDbm: number | null;
  ipAddress: string | null;
}

/**
 * Periodischer Telemetrie-Snapshot.
 * Vendor-neutrale Sicht auf "alles, was gerade Sache ist". Nicht für
 * Auto-Logik (dafür WorkflowEvent), sondern für UI-Updates.
 */
export interface PrinterTelemetryEvent extends PrinterEventEnvelope {
  kind: 'telemetry';
  lifecycle: PrinterLifecycleState;
  /** True wenn der Drucker gerade physisch erreichbar ist. */
  online: boolean;
  /** Letzter physischer Kontakt (ISO-8601). */
  lastSeen: string;
  progress: PrintProgress;
  thermals: ThermalReading[];
  fans: FanReading[];
  lights: LightReading[];
  /** Speed-Profil (1=silent, 4=ludicrous) o. ä. – herstellerneutral als Stufe. */
  speedLevel: 1 | 2 | 3 | 4 | null;
  /** Multiplikator in % (z. B. 80 = 80 % der Profilgeschwindigkeit). */
  speedMagnification: number | null;
  network: NetworkSignal;
  /** Anzahl aktiver HMS-Einträge (Quick-Count für UI). Detail über `PrinterHmsEvent`. */
  activeAlertCount: number;
}

// ─── Workflow ───────────────────────────────────────────────────────────────

/**
 * Domain-Events der Druckerphasen.
 * Diese sind die "ein Mal pro Übergang"-Events – im Gegensatz zur kontinuierlichen
 * Telemetrie. Konsumenten in Notifications / Queue / Cost-Ledger lesen hier.
 */
export type PrinterWorkflowEventType =
  | 'printer.online'
  | 'printer.offline'
  | 'print.started'
  | 'print.progress'
  | 'print.paused'
  | 'print.resumed'
  | 'print.finished'
  | 'print.failed'
  | 'print.cancelled'
  | 'maintenance.entered'
  | 'maintenance.left';

/** Grund eines Pause-/Failure-Übergangs (vendor-neutral). */
export type WorkflowReason =
  | 'user'
  | 'filament_runout'
  | 'filament_tangle'
  | 'ams_stuck'
  | 'thermal_runaway'
  | 'first_layer_failed'
  | 'spaghetti_detected'
  | 'door_open'
  | 'power_loss'
  | 'firmware_error'
  | 'hms'
  | 'unknown';

export interface PrinterWorkflowEvent extends PrinterEventEnvelope {
  kind: 'workflow';
  type: PrinterWorkflowEventType;
  /** Vorheriger Lifecycle-Zustand, falls bekannt. */
  previousState: PrinterLifecycleState | null;
  /** Neuer Lifecycle-Zustand. */
  currentState: PrinterLifecycleState;
  /** Druckauftrag-Kontext, falls relevant. */
  job: {
    jobId: string | null;
    jobName: string | null;
    progressPercent: number | null;
    durationSeconds: number | null;
  } | null;
  /** Auslöser, sofern feststellbar. */
  reason: WorkflowReason | null;
  /** Optionaler Verweis auf einen verknüpften HMS-Event (per ID). */
  linkedHmsEventId?: string;
  /** Frei nutzbarer Strukturkommentar (z. B. "warmup-suppressed"). */
  note?: string;
}

// ─── Commands ───────────────────────────────────────────────────────────────

/**
 * Klassifizierung des Befehlsrisikos – siehe Function Map § 5.1.
 *  - 'read'         = Statusabfrage, kein Hardware-Effekt.
 *  - 'safe'         = Standard-Bedienung (pause/resume/lights).
 *  - 'sensitive'    = Konfiguration, Heizung in normalem Rahmen.
 *  - 'destructive'  = Hardware-Risiko, beliebiger G-Code, Firmware-Update.
 */
export type CommandClass = 'read' | 'safe' | 'sensitive' | 'destructive';

/** Authority-Modus, gegen den der Befehl geprüft wurde. */
export type CommandAuthorityMode = 'live' | 'dev' | 'read_only';

/** Audit-Schweregrad – steuert Persistenz/Alarmierung. */
export type CommandAuditSeverity = 'info' | 'notice' | 'warn' | 'critical';

/**
 * Vendor-neutrale Befehlsmenge. Hersteller-Mapping passiert im Adapter.
 * NEU eingeführte Befehle werden hier ergänzt (nicht im PrinterCommand-Type
 * von printer-status.ts – der ist Legacy und wird mittelfristig migriert).
 */
export type PrinterCommandPayload =
  // Status
  | { type: 'requestStatus' }
  | { type: 'getVersion' }
  // Druck-Steuerung
  | { type: 'pausePrint' }
  | { type: 'resumePrint' }
  | { type: 'cancelPrint' }
  | { type: 'startPrint'; fileRef: string; useAms?: boolean; amsMapping?: number[] }
  | { type: 'skipObjects'; objectIds: number[] }
  | { type: 'setSpeedLevel'; level: 1 | 2 | 3 | 4 }
  // Lichter
  | { type: 'setLight'; channel: LightChannel; on: boolean }
  // Lüfter
  | { type: 'setFan'; channel: FanChannel; speedPercent: number }
  // Temperaturen
  | { type: 'setTemperature'; component: ThermalComponent; targetCelsius: number }
  // AMS
  | { type: 'amsLoadFilament'; amsUnit: number; slot: number }
  | { type: 'amsUnloadFilament' }
  | { type: 'amsControl'; action: 'resume' | 'reset' | 'pause' }
  | {
      type: 'amsFilamentSetting';
      amsUnit: number;
      slot: number;
      material: string;
      colorHex: string;
      nozzleTempMin: number;
      nozzleTempMax: number;
      vendorProfileId?: string;
    }
  | {
      type: 'amsDrying';
      amsUnit: number;
      mode: 'start' | 'stop';
      targetCelsius?: number;
      durationSeconds?: number;
    }
  // Kalibrierung
  | {
      type: 'calibration';
      action: 'home' | 'bed_level' | 'vibration' | 'flow' | 'full';
    }
  // Kamera
  | { type: 'cameraRecord'; on: boolean }
  | { type: 'cameraTimelapse'; on: boolean }
  // XCam / AI-Vision
  | {
      type: 'aiVision';
      module: 'first_layer' | 'spaghetti' | 'monitoring' | 'pileup' | 'clump' | 'airprint' | 'buildplate';
      on: boolean;
      haltOnDetect?: boolean;
    }
  // Bewegung (destruktiv – nur über aiVision/Authority)
  | { type: 'jog'; axis: 'X' | 'Y' | 'Z'; deltaMm: number; feedRate?: number }
  // Roh-G-Code (destruktiv)
  | { type: 'rawGcode'; lines: string[] }
  // Firmware (destruktiv, ADMIN)
  | { type: 'firmwareUpdate'; module: string; version: string; url: string };

/** Wer ist der Auslöser eines Befehls. */
export interface CommandRequester {
  userId: string;
  userRole: 'VIEWER' | 'OPERATOR' | 'OWNER' | 'ADMIN' | 'SYSTEM';
  /** Anzeigename / E-Mail für Audit-Logs. */
  displayName: string | null;
  /** Aufruf-Kontext: REST, WebSocket, Cron, FarmFlow … */
  via: 'rest' | 'websocket' | 'cron' | 'automation' | 'system' | 'cli';
  /** Optionale Session-/Request-ID. */
  sessionId?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Welcher Endpunkt soll den Command physisch ausführen?
 * Bridge bevorzugt, Cloud-Fallback nur wenn Bridge inaktiv.
 */
export interface CommandEndpoint {
  /** Bevorzugter Pfad. */
  preferred: 'bridge.lan' | 'bridge.cloud' | 'backend.cloud';
  /** Optionaler Fallback. */
  fallback?: 'bridge.cloud' | 'backend.cloud';
  /** Konkrete Bridge-Instanz (falls preferred = bridge.*). */
  bridgeId?: string;
  /** Hersteller-Topic, falls schon aufgelöst (Adapter-intern, debug-only). */
  resolvedTopic?: string;
}

/**
 * Authority-Check-Footprint. Wird VOR dem Send befüllt und am Result
 * unverändert übernommen, damit der Audit-Log lückenlos ist.
 */
export interface CommandAuthorityCheck {
  mode: CommandAuthorityMode;
  /** Ergebnis der Klassifizierung. */
  commandClass: CommandClass;
  /** Hat die Rolle die Klasse abgedeckt? */
  rolePermitted: boolean;
  /** Gilt eine Bestätigungspflicht (Doppel-Klick / 2FA)? */
  requiresConfirmation: boolean;
  /** Hat der Aufrufer bestätigt? */
  confirmed: boolean;
  /** Ist der Befehl nur als Trockenlauf (DEV-Mode) erlaubt? */
  dryRun: boolean;
  /** Verhinderungsgrund (nur wenn `rolePermitted=false`). */
  rejectionReason?:
    | 'role_insufficient'
    | 'authority_read_only'
    | 'authority_dev_destructive'
    | 'confirmation_missing'
    | 'feature_disabled'
    | 'rate_limited';
}

export interface PrinterCommandRequest extends PrinterEventEnvelope {
  kind: 'command.request';
  /** Eindeutige Request-ID, dieselbe wird im Result referenziert. */
  commandId: string;
  payload: PrinterCommandPayload;
  requestedBy: CommandRequester;
  endpoint: CommandEndpoint;
  authorityCheck: CommandAuthorityCheck;
  /** Audit-Schweregrad (steuert Persistenz/Alarm). */
  auditSeverity: CommandAuditSeverity;
  /** Soft-Timeout, nach dem Result als 'timeout' gewertet wird. */
  timeoutMs: number;
}

export type CommandResultStatus =
  | 'accepted'           // Bridge/Adapter akzeptiert, läuft
  | 'completed'          // Drucker hat ausgeführt und geantwortet
  | 'rejected'           // Authority/Validation hat den Command vor Send geblockt
  | 'failed'             // Drucker hat geantwortet, aber Fehler
  | 'timeout'            // Keine Antwort in `timeoutMs`
  | 'dropped'            // Bridge offline / Drucker offline
  | 'duplicate';         // Dedup-Filter (gleiche commandId schon verarbeitet)

export interface PrinterCommandResult extends PrinterEventEnvelope {
  kind: 'command.result';
  /** Referenz auf `PrinterCommandRequest.commandId`. */
  commandId: string;
  status: CommandResultStatus;
  /** Hersteller-Antwortcode, falls vorhanden. */
  vendorResultCode?: string | number;
  /** Klartext-Begründung (vendor-neutral). */
  message?: string;
  /** Latenz Send → Antwort in Millisekunden. */
  latencyMs: number | null;
  /** Audit-relevante Kopien aus dem Request (denormalisiert für Log-Export). */
  audit: {
    requestedBy: CommandRequester;
    endpoint: CommandEndpoint;
    authorityCheck: CommandAuthorityCheck;
    auditSeverity: CommandAuditSeverity;
  };
}

// ─── HMS / Health Management ────────────────────────────────────────────────

export type HmsSeverity = 'fatal' | 'serious' | 'common' | 'info';

export type HmsModule =
  | 'mainboard'
  | 'motion_controller'
  | 'toolhead'
  | 'ams'
  | 'ams_lite'
  | 'ams_ht'
  | 'hotend_rack'
  | 'camera'
  | 'xcam'
  | 'firmware'
  | 'unknown';

export type HmsLifecycle = 'raised' | 'updated' | 'cleared';

export interface PrinterHmsEvent extends PrinterEventEnvelope {
  kind: 'hms';
  /** Eindeutige ID des Issue-Lifecycles (überlebt raised → cleared). */
  hmsEventId: string;
  lifecycle: HmsLifecycle;
  severity: HmsSeverity;
  module: HmsModule;
  /** Vendor-neutraler Code (z. B. Bambu HMS-Code "0300_0100_0001_0007"). */
  code: string;
  /** Übersetzte Beschreibung in Locale `descriptionLocale`. */
  description: string | null;
  descriptionLocale: 'de' | 'en' | 'unknown';
  /** Optionaler Wiki-/Doc-Link. */
  documentationUrl: string | null;
  /** Legt der Drucker eine empfohlene Aktion nahe? */
  recommendedAction: string | null;
  /** Wann der Issue zuerst registriert wurde (für Lifecycle-Korrelation). */
  firstSeenAt: string;
  /** Wenn `lifecycle === 'cleared'`: Zeitpunkt des Verschwindens. */
  clearedAt: string | null;
}

// ─── Material / AMS ─────────────────────────────────────────────────────────

export type MaterialEventType =
  | 'material.loaded'
  | 'material.unloaded'
  | 'material.changed'
  | 'material.runout'
  | 'material.tag_scanned'
  | 'material.dryrun_started'
  | 'material.dryrun_finished'
  | 'material.tray_now_changed';

export interface MaterialIdentity {
  /** Vafrum-interne Spool-ID, falls bereits zugeordnet. */
  spoolId: string | null;
  /** Material-Name (vendor-neutral, z. B. "PLA", "PETG-CF"). */
  material: string | null;
  /** Hex-Farbe ohne `#`, RGB. */
  colorHex: string | null;
  /** Anzeigename (Hersteller + Subtyp). */
  displayName: string | null;
  /** Vendor-Profil-ID (z. B. Bambu `tray_info_idx`). */
  vendorProfileId: string | null;
  /** RFID-Tag-UID, falls vorhanden. */
  rfidTagUid: string | null;
  /** Stabile Tray-UUID (Vendor). */
  vendorTrayUuid: string | null;
  /** Verbleibende Menge in % (-1/Null = unbekannt). */
  remainingPercent: number | null;
  /** Bekanntes Restgewicht in Gramm. */
  remainingGrams: number | null;
  nozzleTempMin: number | null;
  nozzleTempMax: number | null;
  /** Bett-Empfehlung pro Tray (Bambu §1.7.24, optional). */
  bedTemp?: number | null;
  /** XCam-Hinweise pro Tray (Bambu §1.7.25, optional, raw). */
  xcamInfo?: string | null;
}

export interface PrinterMaterialEvent extends PrinterEventEnvelope {
  kind: 'material';
  type: MaterialEventType;
  /** AMS-Unit-Index (0-basiert). `null` für externen Halter. */
  amsUnit: number | null;
  /** Slot innerhalb der AMS-Unit (0-basiert). `null` für externen Halter. */
  slot: number | null;
  /** True wenn dieser Slot/Tray gerade aktiv druckt. */
  isActiveTray: boolean;
  /** Tray-State NACH dem Event (null wenn entfernt). */
  current: MaterialIdentity | null;
  /** Tray-State VOR dem Event (null wenn neu eingelegt). */
  previous: MaterialIdentity | null;
  /** Vorgeschlagene Spool-Matches aus dem Lager-Katalog. */
  suggestions: Array<{
    spoolId: string;
    name: string;
    colorHex: string;
    /** 0–1, höhere Werte = sicherer Match. */
    confidence: number;
  }>;
  /** Trocknungs-Kontext, wenn `type` ein Dryrun-Event ist. */
  drying?: {
    targetCelsius: number;
    remainingSeconds: number;
    humidityPercent: number | null;
  };
}

// ─── Bridge Health ──────────────────────────────────────────────────────────

export type BridgeHealthStatus =
  | 'healthy'
  | 'degraded'   // Reconnects häufen sich, Latenz steigt
  | 'stale'      // Bridge online, aber kein Drucker-Status > 30 s
  | 'offline'    // Bridge nicht erreichbar
  | 'rejected'   // Authentifizierung schlug fehl
  | 'updating';  // Bridge führt gerade ein Update aus

export type BridgeTransport = 'lan_mqtt' | 'cloud_mqtt' | 'mixed';

export interface BridgeHealthEvent extends PrinterEventEnvelope {
  kind: 'bridge.health';
  /**
   * Bei Bridge-Health ist `printerId`/`serial` optional gemeint, kann aber
   * `''` sein, wenn der Event die Bridge insgesamt betrifft.
   * `bridgeId` ist hier IMMER gesetzt und der primäre Identifier.
   */
  status: BridgeHealthStatus;
  transport: BridgeTransport;
  /** Bridge-Buildversion (Tauri / mqtt-client). */
  bridgeVersion: string | null;
  /** Wie lange der Status schon andauert (Sekunden). */
  inStatusForSeconds: number;
  /** Anzahl Drucker, die diese Bridge gerade bedient. */
  managedPrinterCount: number;
  /** Anzahl Drucker mit frischem Status (< 30 s). */
  freshPrinterCount: number;
  /** Letzter Reconnect-Zeitpunkt, falls relevant. */
  lastReconnectAt: string | null;
  /** Anzahl Reconnects in den letzten 5 Minuten. */
  reconnectsLast5Min: number;
  /** Optional: warum aktuell `degraded`/`stale`/`rejected`. */
  diagnostic: {
    code:
      | 'ok'
      | 'no_status_received'
      | 'mqtt_disconnected'
      | 'auth_failed'
      | 'rate_limited'
      | 'high_latency'
      | 'version_mismatch'
      | 'unknown';
    message: string | null;
    /** Letzte gemessene Round-Trip-Zeit in ms. */
    lastLatencyMs: number | null;
  };
}

// ─── Discriminated Union & Type Guards ──────────────────────────────────────

export type PrinterEvent =
  | PrinterTelemetryEvent
  | PrinterWorkflowEvent
  | PrinterHmsEvent
  | PrinterMaterialEvent
  | BridgeHealthEvent
  | PrinterCommandRequest
  | PrinterCommandResult;

export const isTelemetryEvent = (e: PrinterEvent): e is PrinterTelemetryEvent =>
  e.kind === 'telemetry';
export const isWorkflowEvent = (e: PrinterEvent): e is PrinterWorkflowEvent =>
  e.kind === 'workflow';
export const isHmsEvent = (e: PrinterEvent): e is PrinterHmsEvent =>
  e.kind === 'hms';
export const isMaterialEvent = (e: PrinterEvent): e is PrinterMaterialEvent =>
  e.kind === 'material';
export const isBridgeHealthEvent = (e: PrinterEvent): e is BridgeHealthEvent =>
  e.kind === 'bridge.health';
export const isCommandRequest = (e: PrinterEvent): e is PrinterCommandRequest =>
  e.kind === 'command.request';
export const isCommandResult = (e: PrinterEvent): e is PrinterCommandResult =>
  e.kind === 'command.result';
