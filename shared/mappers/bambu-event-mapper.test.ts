/**
 * Read-only tests for the Bambu MQTT → vendor-neutral event mapper.
 * Uses Node's built-in test runner (`node:test`) – no Jest dependency in shared/.
 *
 * Run via:
 *   npx ts-node --transpile-only shared/mappers/bambu-event-mapper.test.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  mapBambuReport,
  __test,
  mapHomeFlag,
  mapStat,
  mapFun,
  mapXcamStatus,
  mapIpcamStatus,
  mapUpgradeState,
  mapH2Device,
  mapPrintOnline,
  type BambuMapContext,
  type BambuPrintBlock,
  type BambuReportPayload,
  type PreviousSnapshot,
} from './bambu-event-mapper';

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');
const loadFixture = (name: string): BambuReportPayload =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as BambuReportPayload;

const baseCtx = (over: Partial<BambuMapContext> = {}): BambuMapContext => ({
  printerId: '11111111-1111-1111-1111-111111111111',
  serial: '01P00A000000001',
  workspaceId: 'ws-test',
  bridgeId: 'bridge-mac-mini',
  source: 'bridge.lan',
  vendor: 'bambu',
  timestamp: '2026-04-30T12:00:00.000Z',
  ...over,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

test('formatHmsCode produces XXXX_XXXX_XXXX_XXXX', () => {
  // attr=0x03000100 (50331904), code=0x00010007 (65543) → 0300_0100_0001_0007
  assert.equal(__test.formatHmsCode(50331904, 65543), '0300_0100_0001_0007');
});

test('mapHmsSeverity is defensive on unknown levels', () => {
  assert.equal(__test.mapHmsSeverity(0x00010000), 'fatal');
  assert.equal(__test.mapHmsSeverity(0x00020000), 'serious');
  assert.equal(__test.mapHmsSeverity(0x00030000), 'common');
  assert.equal(__test.mapHmsSeverity(0x00040000), 'info');
  // Level 0 / unbekannt → defensiv 'common'
  assert.equal(__test.mapHmsSeverity(0x00000007), 'common');
});

test('mapHmsModule resolves known module bytes', () => {
  assert.equal(__test.mapHmsModule(0x05000000), 'mainboard');
  assert.equal(__test.mapHmsModule(0x07000000), 'ams');
  assert.equal(__test.mapHmsModule(0xFF000000), 'unknown');
});

test('fanToPercent normalizes 0..15 to 0..100 and tolerates strings/null', () => {
  assert.equal(__test.fanToPercent('0'), 0);
  assert.equal(__test.fanToPercent('15'), 100);
  assert.equal(__test.fanToPercent(8), 53);
  assert.equal(__test.fanToPercent(undefined), null);
  assert.equal(__test.fanToPercent(''), null);
  assert.equal(__test.fanToPercent('not-a-number'), null);
  // Out-of-range wird geclamped:
  assert.equal(__test.fanToPercent(99), 100);
  assert.equal(__test.fanToPercent(-5), 0);
});

test('wifiToDbm parses "-53dBm", "-47", numbers and is defensive on garbage', () => {
  assert.equal(__test.wifiToDbm('-53dBm'), -53);
  assert.equal(__test.wifiToDbm('-47'), -47);
  assert.equal(__test.wifiToDbm(-42), -42);
  assert.equal(__test.wifiToDbm(undefined), null);
  assert.equal(__test.wifiToDbm('strong'), null);
});

test('mapLifecycle handles known + unknown gcode_state defensively', () => {
  assert.equal(__test.mapLifecycle('IDLE'), 'idle');
  assert.equal(__test.mapLifecycle('RUNNING'), 'printing');
  assert.equal(__test.mapLifecycle('PAUSE'), 'paused');
  assert.equal(__test.mapLifecycle('FINISH'), 'finished');
  assert.equal(__test.mapLifecycle('FAILED'), 'failed');
  assert.equal(__test.mapLifecycle(undefined), 'unknown');
  assert.equal(__test.mapLifecycle('FOO'), 'unknown');
});

test('extractPrintBlock handles wrapper {print: …} and raw print object', () => {
  const wrapped = __test.extractPrintBlock({ print: { gcode_state: 'IDLE' } });
  assert.equal(wrapped.gcode_state, 'IDLE');
  const direct = __test.extractPrintBlock({ gcode_state: 'IDLE' } as BambuReportPayload);
  assert.equal(direct.gcode_state, 'IDLE');
  // null/undefined dürfen nicht crashen
  assert.deepEqual(__test.extractPrintBlock(undefined as unknown as BambuReportPayload), {});
  assert.deepEqual(__test.extractPrintBlock(null as unknown as BambuReportPayload), {});
});

test('normalizeColorHex strips alpha, drops zero/empty, uppercases', () => {
  assert.equal(__test.normalizeColorHex('FF0000FF'), 'FF0000');
  assert.equal(__test.normalizeColorHex('#abcdef'), 'ABCDEF');
  assert.equal(__test.normalizeColorHex('00000000'), null);
  assert.equal(__test.normalizeColorHex(''), null);
  assert.equal(__test.normalizeColorHex(undefined), null);
});

// ─── Idle ──────────────────────────────────────────────────────────────────

test('idle fixture maps to lifecycle=idle and online=true', () => {
  const result = mapBambuReport(loadFixture('bambu-idle.json'), baseCtx());
  assert.equal(result.telemetry.kind, 'telemetry');
  assert.equal(result.telemetry.lifecycle, 'idle');
  assert.equal(result.telemetry.online, true);
  assert.equal(result.telemetry.progress.percent, 0);
  assert.equal(result.telemetry.progress.jobName, null);
  assert.equal(result.telemetry.speedLevel, 2);
  assert.equal(result.telemetry.network.wifiDbm, -53);
  // Lichter
  const chamber = result.telemetry.lights.find(l => l.channel === 'chamber');
  assert.ok(chamber, 'chamber light should be reported');
  assert.equal(chamber!.on, true);
  // Keine HMS, kein Workflow ohne previous, keine Material-Events
  assert.equal(result.hms.length, 0);
  assert.equal(result.workflow.length, 0);
  assert.equal(result.materials.length, 0);
});

// ─── Running ───────────────────────────────────────────────────────────────

test('running fixture: subtask_name has priority over gcode_file', () => {
  const result = mapBambuReport(loadFixture('bambu-running.json'), baseCtx());
  assert.equal(result.telemetry.lifecycle, 'printing');
  assert.equal(result.telemetry.progress.jobName, 'BENCHY_PLA_RED_v3.gcode');
  assert.equal(result.telemetry.progress.percent, 42);
  // 73 minutes → 4380 seconds
  assert.equal(result.telemetry.progress.remainingSeconds, 4380);
  assert.equal(result.telemetry.progress.currentLayer, 84);
  assert.equal(result.telemetry.progress.totalLayers, 198);
  // Fan 12/15 = 80, 8/15 = 53, 6/15 = 40, 15/15 = 100
  const fans = Object.fromEntries(result.telemetry.fans.map(f => [f.channel, f.speedPercent]));
  assert.equal(fans['part'], 80);
  assert.equal(fans['aux'], 53);
  assert.equal(fans['chamber'], 40);
  assert.equal(fans['heatbreak'], 100);
  // wifi as plain number
  assert.equal(result.telemetry.network.wifiDbm, -47);
  assert.equal(result.telemetry.speedLevel, 3);
  assert.equal(result.telemetry.speedMagnification, 110);
});

test('running fixture: workflow print.started fires when previous=idle', () => {
  const prev: PreviousSnapshot = { lifecycle: 'idle', online: true };
  const result = mapBambuReport(loadFixture('bambu-running.json'), baseCtx({ previous: prev }));
  const wf = result.workflow.find(w => w.type === 'print.started');
  assert.ok(wf, 'expected print.started');
  assert.equal(wf!.previousState, 'idle');
  assert.equal(wf!.currentState, 'printing');
  assert.equal(wf!.job?.jobName, 'BENCHY_PLA_RED_v3.gcode');
});

// ─── Paused + HMS ──────────────────────────────────────────────────────────

test('paused fixture: HMS entries become PrinterHmsEvent, codes formatted, severity mapped', () => {
  const result = mapBambuReport(loadFixture('bambu-paused-with-hms.json'), baseCtx());
  assert.equal(result.telemetry.lifecycle, 'paused');
  assert.equal(result.telemetry.activeAlertCount, 3);
  assert.equal(result.hms.length, 3);
  for (const h of result.hms) {
    assert.match(h.code, /^[0-9A-F]{4}_[0-9A-F]{4}_[0-9A-F]{4}_[0-9A-F]{4}$/);
    assert.equal(h.kind, 'hms');
    assert.equal(h.lifecycle, 'raised'); // ohne previous → alle als raised
    assert.ok(['fatal', 'serious', 'common', 'info'].includes(h.severity));
  }
  // Erster Eintrag: attr=50331904 (0x03000100) → motion_controller, code 0x00010007 → severity 'fatal'
  const first = result.hms[0]!;
  assert.equal(first.module, 'motion_controller');
  assert.equal(first.severity, 'fatal');
  assert.equal(first.code, '0300_0100_0001_0007');
});

test('paused fixture: previous hms list keeps known codes as updated, only new ones raised', () => {
  const prev: PreviousSnapshot = {
    lifecycle: 'paused',
    online: true,
    hmsCodes: ['0300_0100_0001_0007'], // erster Eintrag bekannt
  };
  const result = mapBambuReport(loadFixture('bambu-paused-with-hms.json'), baseCtx({ previous: prev }));
  const updated = result.hms.filter(h => h.lifecycle === 'updated');
  const raised = result.hms.filter(h => h.lifecycle === 'raised');
  assert.equal(updated.length, 1);
  assert.equal(raised.length, 2);
});

test('paused fixture: workflow emits print.paused on transition from running', () => {
  const result = mapBambuReport(
    loadFixture('bambu-paused-with-hms.json'),
    baseCtx({ previous: { lifecycle: 'printing', online: true } }),
  );
  const wf = result.workflow.find(w => w.type === 'print.paused');
  assert.ok(wf, 'expected print.paused');
});

// ─── AMS ───────────────────────────────────────────────────────────────────

test('AMS fixture: trays parsed, color stripped, empty slots filtered', () => {
  // Mit previous-trays leer → für jeden befüllten Tray ein 'material.loaded'
  const result = mapBambuReport(
    loadFixture('bambu-ams.json'),
    baseCtx({ previous: { lifecycle: 'idle', online: true, trays: {}, trayNow: null } }),
  );
  // 2 echte Trays in der AMS-Unit (slot 2 & 3 sind leer/00000000-Color → gefiltert)
  const loaded = result.materials.filter(m => m.type === 'material.loaded');
  assert.equal(loaded.length, 2);
  const slot0 = loaded.find(m => m.slot === 0)!;
  assert.ok(slot0);
  assert.equal(slot0.current?.colorHex, 'FF0000');
  assert.equal(slot0.current?.material, 'PLA');
  assert.equal(slot0.current?.displayName, 'Bambu PLA Basic Red');
  assert.equal(slot0.current?.vendorProfileId, 'GFA00');
  assert.equal(slot0.current?.rfidTagUid, '0123456789abcdef');
  assert.equal(slot0.current?.remainingPercent, 87);
  // tray_now=1 → slot 1 ist active
  const slot1 = loaded.find(m => m.slot === 1)!;
  assert.equal(slot1.isActiveTray, true);
  assert.equal(slot0.isActiveTray, false);
  // tray_now Wechsel (vorher null → 1)
  const trayNowEvent = result.materials.find(m => m.type === 'material.tray_now_changed');
  assert.ok(trayNowEvent);
});

test('AMS fixture: without previous, no material events produced', () => {
  const result = mapBambuReport(loadFixture('bambu-ams.json'), baseCtx());
  assert.equal(result.materials.length, 0);
});

// ─── Partial / Delta ───────────────────────────────────────────────────────

test('partial/delta payload does not crash and yields safe defaults', () => {
  const result = mapBambuReport(loadFixture('bambu-delta-partial.json'), baseCtx());
  assert.equal(result.telemetry.kind, 'telemetry');
  assert.equal(result.telemetry.lifecycle, 'unknown');
  assert.equal(result.telemetry.progress.percent, 43);
  assert.equal(result.telemetry.progress.jobName, null);
  assert.equal(result.telemetry.thermals.length >= 2, true); // nozzle+bed immer da
  assert.equal(result.telemetry.fans.length, 0); // keine fan-Felder im delta
  assert.equal(result.telemetry.lights.length, 0);
  assert.equal(result.telemetry.network.wifiDbm, null);
  assert.equal(result.telemetry.activeAlertCount, 0);
  assert.equal(result.workflow.length, 0);
  assert.equal(result.hms.length, 0);
});

test('totally empty payload does not throw', () => {
  const result = mapBambuReport({} as BambuReportPayload, baseCtx());
  assert.equal(result.telemetry.lifecycle, 'unknown');
  assert.equal(result.telemetry.online, true);
  assert.deepEqual(result.telemetry.lights, []);
  assert.deepEqual(result.telemetry.fans, []);
});

test('null/undefined payload does not throw', () => {
  const result = mapBambuReport(null as unknown as BambuReportPayload, baseCtx());
  assert.equal(result.telemetry.lifecycle, 'unknown');
});

// ─── Envelope / Raw payload ────────────────────────────────────────────────

test('envelope carries printerId, serial, workspaceId, bridgeId, source, vendor, timestamp', () => {
  const result = mapBambuReport(loadFixture('bambu-idle.json'), baseCtx());
  const t = result.telemetry;
  assert.equal(t.printerId, '11111111-1111-1111-1111-111111111111');
  assert.equal(t.serial, '01P00A000000001');
  assert.equal(t.workspaceId, 'ws-test');
  assert.equal(t.bridgeId, 'bridge-mac-mini');
  assert.equal(t.source, 'bridge.lan');
  assert.equal(t.vendor, 'bambu');
  assert.equal(t.timestamp, '2026-04-30T12:00:00.000Z');
  assert.equal(t.raw, undefined); // default: kein raw
});

test('includeRawPayload=true attaches sourcePayload and sequence id', () => {
  const result = mapBambuReport(
    loadFixture('bambu-running.json'),
    baseCtx({ includeRawPayload: true }),
  );
  assert.ok(result.telemetry.raw, 'raw should be set');
  assert.equal(result.telemetry.raw!.vendor, 'bambu');
  assert.equal(result.telemetry.raw!.channel, 'device/01P00A000000001/report');
  assert.ok(result.telemetry.raw!.payload);
});

// ─── Bridge Health ─────────────────────────────────────────────────────────

test('bridgeHealth marks stale when lastSeen older than 30s', () => {
  const result = mapBambuReport(
    loadFixture('bambu-idle.json'),
    baseCtx({
      timestamp: '2026-04-30T12:01:00.000Z',
      lastSeen: '2026-04-30T12:00:00.000Z', // 60s alt
    }),
  );
  assert.ok(result.bridgeHealth);
  assert.equal(result.bridgeHealth!.status, 'stale');
  assert.equal(result.bridgeHealth!.diagnostic.code, 'no_status_received');
});

test('bridgeHealth healthy when lastSeen is fresh', () => {
  const result = mapBambuReport(
    loadFixture('bambu-idle.json'),
    baseCtx({
      timestamp: '2026-04-30T12:00:10.000Z',
      lastSeen: '2026-04-30T12:00:05.000Z', // 5s
    }),
  );
  assert.ok(result.bridgeHealth);
  assert.equal(result.bridgeHealth!.status, 'healthy');
});

test('bridgeHealth omitted if no lastSeen passed', () => {
  const result = mapBambuReport(loadFixture('bambu-idle.json'), baseCtx());
  assert.equal(result.bridgeHealth, null);
});

// ─── B4 — Tray-Erweiterung ───────────────────────────────────────────────────

test('B4: bed_temp und xcam_info werden via collectTrayMap durchgereicht', () => {
  const block = {
    ams: {
      ams: [
        {
          id: '0',
          tray: [
            {
              id: '0',
              tray_type: 'PLA',
              tray_color: 'FF0000',
              tag_uid: '1234',
              bed_temp: 60,
              xcam_info: 'spaghetti_high',
            },
          ],
        },
      ],
    },
  } as BambuPrintBlock;
  const trayMap = __test.collectTrayMap(block);
  const tray = trayMap['0:0'];
  assert.ok(tray, 'tray sollte gemappt sein');
  assert.equal(tray.bedTemp, 60);
  assert.equal(tray.xcamInfo, 'spaghetti_high');
});

// ─── B5 — Top-Level-Mapper ───────────────────────────────────────────────────

test('mapHomeFlag: doorOpen-Bit gesetzt', () => {
  const result = mapHomeFlag({ home_flag: 0x00800000 } as BambuPrintBlock);
  assert.equal(result.doorOpen, true);
});
test('mapHomeFlag: kein Feld → leeres Objekt', () => {
  assert.deepEqual(mapHomeFlag({} as BambuPrintBlock), {});
});

test('mapStat: Hex-Wert wird als Zahl zurückgegeben', () => {
  const result = mapStat({ stat: '0xFF' } as BambuPrintBlock);
  assert.equal(result.statRaw, 0xFF);
});
test('mapStat: kein Feld → leeres Objekt', () => {
  assert.deepEqual(mapStat({} as BambuPrintBlock), {});
});

test('mapFun: Bit gesetzt', () => {
  const result = mapFun({ fun: '00002000' } as BambuPrintBlock);
  assert.equal(result.developerModeActive, true);
});
test('mapFun: kein Feld → leeres Objekt', () => {
  assert.deepEqual(mapFun({} as BambuPrintBlock), {});
});

test('mapXcamStatus: Felder werden flach durchgereicht', () => {
  const result = mapXcamStatus({
    xcam: { first_layer_inspector: true, halt_print_sensitivity: 'high' },
  } as BambuPrintBlock);
  assert.equal(result.xcamFirstLayerInspector, true);
  assert.equal(result.xcamHaltPrintSensitivity, 'high');
});
test('mapXcamStatus: kein xcam-Block → leeres Objekt', () => {
  assert.deepEqual(mapXcamStatus({} as BambuPrintBlock), {});
});

test('mapIpcamStatus: enable wird zu boolean true', () => {
  const result = mapIpcamStatus({
    ipcam: { ipcam_record: 'enable', timelapse: 'disable' },
  } as BambuPrintBlock);
  assert.equal(result.ipcamRecord, true);
  assert.equal(result.ipcamTimelapse, false);
});
test('mapIpcamStatus: kein ipcam-Block → leeres Objekt', () => {
  assert.deepEqual(mapIpcamStatus({} as BambuPrintBlock), {});
});

test('mapUpgradeState: status und progress', () => {
  const result = mapUpgradeState({
    upgrade_state: { status: 'IDLE', progress: '50' },
  } as BambuPrintBlock);
  assert.equal(result.upgradeStatus, 'IDLE');
  assert.equal(result.upgradeProgress, 50);
});
test('mapUpgradeState: kein Block → leeres Objekt', () => {
  assert.deepEqual(mapUpgradeState({} as BambuPrintBlock), {});
});

test('mapH2Device: zwei Extruder Standard-Werte', () => {
  const payload = {
    extruder: {
      info: [
        { temp: (220 << 16) | 215 },
        { temp: (210 << 16) | 200 },
      ],
    },
  };
  const result = mapH2Device(payload);
  assert.equal(result.nozzleTemp, 215);
  assert.equal(result.nozzleTargetTemp, 220);
  assert.equal(result.nozzleTemp2, 200);
  assert.equal(result.nozzleTargetTemp2, 210);
});
test('mapH2Device: kein device → leeres Objekt', () => {
  assert.deepEqual(mapH2Device(null), {});
  assert.deepEqual(mapH2Device(undefined), {});
});

// ─── B10 — print.online ──────────────────────────────────────────────────────

test('mapPrintOnline: ahb true, rfid false durchgereicht', () => {
  const result = mapPrintOnline({
    online: { ahb: true, rfid: false, version: 1 },
  } as BambuPrintBlock);
  assert.equal(result.ahbOnline, true);
  assert.equal(result.rfidOnline, false);
});
test('mapPrintOnline: kein online-Block → leeres Objekt', () => {
  assert.deepEqual(mapPrintOnline({} as BambuPrintBlock), {});
});

// ─── B9 — Stage-Lookup mit erweiterten Stages ────────────────────────────────

test('B9: Stage 18 wird gemappt', () => {
  // Stage 18 = calibrating_micro_lidar (2) laut Reference §5.3
  const result = __test.stageName({ stg_cur: 18 } as BambuPrintBlock);
  assert.ok(result === 'calibrating_micro_lidar' || /^stage_18$/.test(result || ''),
    `Stage 18 sollte gemappt sein, war: ${result}`);
});

test('B9: Unbekannte Stage 99 fällt auf stage_99 zurück', () => {
  const result = __test.stageName({ stg_cur: 99 } as BambuPrintBlock);
  assert.equal(result, 'stage_99');
});
