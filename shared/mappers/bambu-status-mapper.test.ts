import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildPrinterStatusFromBambuReport } from './bambu-status-mapper';
import type { BambuPrintBlock, BambuReportPayload } from './bambu-event-mapper';

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');

function loadFixture(name: string): BambuReportPayload {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as BambuReportPayload;
}

function extractBlock(fixture: any): { block: BambuPrintBlock; device: unknown } {
  const payload = fixture?.payload ?? fixture;
  const block = (payload?.print ?? payload) as BambuPrintBlock;
  const device = (payload?.device ?? (block as any)?.device) ?? undefined;
  return { block, device };
}

test('buildPrinterStatusFromBambuReport: minimaler Block setzt Defaults und Modell-Detection', () => {
  const status = buildPrinterStatusFromBambuReport('094XXXX', { command: 'push_status' } as BambuPrintBlock);
  assert.equal(status.serialNumber, '094XXXX');
  assert.equal(status.printerId, '094XXXX');
  assert.equal(status.online, true);
  assert.equal(status.modelClass, 'safe');
  assert.equal(status.modelFamily, 'A1');
  assert.equal(status.gcodeState, 'IDLE');
  assert.equal(status.printProgress, 0);
  assert.equal(status.nozzleTemp, 0);
  assert.equal(status.bedTemp, 0);
  assert.ok(status.lastSeen instanceof Date);
});

test('buildPrinterStatusFromBambuReport: Standard-Felder durchgereicht', () => {
  const block = {
    command: 'push_status',
    gcode_state: 'RUNNING',
    mc_percent: 42,
    mc_remaining_time: 120,
    layer_num: 50,
    total_layer_num: 200,
    nozzle_temper: 215,
    nozzle_target_temper: 220,
    bed_temper: 60,
    bed_target_temper: 60,
    chamber_temper: 28,
    cooling_fan_speed: 10,
    subtask_name: 'test.gcode',
  } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.gcodeState, 'RUNNING');
  assert.equal(s.printProgress, 42);
  assert.equal(s.remainingTime, 120);
  assert.equal(s.layer, 50);
  assert.equal(s.totalLayers, 200);
  assert.equal(s.nozzleTemp, 215);
  assert.equal(s.nozzleTargetTemp, 220);
  assert.equal(s.bedTemp, 60);
  assert.equal(s.chamberTemp, 28);
  assert.equal(s.partFanSpeed, 10);
  assert.equal(s.currentFile, 'test.gcode');
  assert.equal(s.modelClass, 'safe');
  assert.equal(s.modelFamily, 'X1');
});

test('buildPrinterStatusFromBambuReport: home_flag setzt doorOpen', () => {
  const block = { command: 'push_status', home_flag: 0x00800000 } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.doorOpen, true);
  assert.equal(s.filamentTangle, false);
  assert.equal(s.homeFlagRaw, 0x00800000);
});

test('buildPrinterStatusFromBambuReport: H2D Multi-Extruder via devicePayload', () => {
  const block = { command: 'push_status' } as BambuPrintBlock;
  const devicePayload = {
    extruder: {
      info: [
        { temp: (220 << 16) | 215 },
        { temp: (210 << 16) | 200 },
      ],
    },
  };
  const s = buildPrinterStatusFromBambuReport('UNKNOWN_H2D', block, devicePayload);
  assert.equal(s.nozzleTemp, 215);
  assert.equal(s.nozzleTargetTemp, 220);
  assert.equal(s.nozzleTemp2, 200);
  assert.equal(s.nozzleTargetTemp2, 210);
});

test('buildPrinterStatusFromBambuReport: lights_report setzt Beleuchtung als boolean', () => {
  const block = {
    command: 'push_status',
    lights_report: [
      { node: 'chamber_light', mode: 'on' },
      { node: 'work_light', mode: 'off' },
    ],
  } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.chamberLight, true);
  assert.equal(s.workLight, false);
});

test('buildPrinterStatusFromBambuReport: AMS-Block wird in flache units/trays gemappt', () => {
  const block = {
    command: 'push_status',
    ams: {
      ams: [
        {
          id: '0',
          temp: '25',
          humidity: '30',
          tray: [
            { id: '0', tray_color: 'FF0000FF', tray_type: 'PLA', remain: 80, k: 0.02 },
          ],
        },
      ],
      tray_now: '254',
      ams_exist_bits: '1',
    },
  } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.ams?.units?.length, 1);
  assert.equal(s.ams?.units?.[0].id, 0);
  assert.equal(s.ams?.units?.[0].temp, 25);
  assert.equal(s.ams?.units?.[0].humidity, 30);
  assert.equal(s.ams?.trays?.length, 1);
  assert.equal(s.ams?.trays?.[0].unitId, 0);
  assert.equal(s.ams?.trays?.[0].slot, 0);
  assert.equal(s.ams?.trays?.[0].color, 'FF0000FF');
  assert.equal(s.ams?.trays?.[0].type, 'PLA');
  assert.equal(s.ams?.trays?.[0].remain, 80);
  assert.equal(s.ams?.trayNow, 254);
  assert.equal(s.ams?.amsExistBits, 1);
});

test('buildPrinterStatusFromBambuReport: HMS-Array wird als rohe HmsEntry-Liste durchgereicht', () => {
  const block = {
    command: 'push_status',
    hms: [{ attr: 0x05000300, code: 0x00010001 }],
  } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.hms?.length, 1);
  assert.equal(s.hms?.[0].attr, 0x05000300);
  assert.equal(s.hms?.[0].code, 0x00010001);
});

test('buildPrinterStatusFromBambuReport: print.online ahb/rfid', () => {
  const block = { command: 'push_status', online: { ahb: true, rfid: false, version: 1 } } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.ahbOnline, true);
  assert.equal(s.rfidOnline, false);
});

test('buildPrinterStatusFromBambuReport: subtaskId/projectId/taskId und failReason', () => {
  const block = {
    command: 'push_status',
    subtask_id: 'st-123',
    project_id: 'pr-456',
    task_id: 'tk-789',
    fail_reason: 'thermistor_disconnected',
    gcode_start_time: '2026-05-04T10:00:00Z',
  } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.subtaskId, 'st-123');
  assert.equal(s.projectId, 'pr-456');
  assert.equal(s.taskId, 'tk-789');
  assert.equal(s.failReason, 'thermistor_disconnected');
  assert.equal(s.gcodeStartTime, '2026-05-04T10:00:00Z');
});

test('buildPrinterStatusFromBambuReport: wifi_signal als String wird zu number geparst', () => {
  const block = { command: 'push_status', wifi_signal: '-50dBm' } as BambuPrintBlock;
  const s = buildPrinterStatusFromBambuReport('01SXXXX', block);
  assert.equal(s.wifiSignal, -50);
});

test('buildPrinterStatusFromBambuReport: unbekanntes Serial → modelClass/Family null', () => {
  const s = buildPrinterStatusFromBambuReport(
    'TOTALLYUNKNOWN',
    { command: 'push_status' } as BambuPrintBlock,
  );
  assert.equal(s.modelClass, null);
  assert.equal(s.modelFamily, null);
});

test('buildPrinterStatusFromBambuReport: ctx.printerId überschreibt Default', () => {
  const s = buildPrinterStatusFromBambuReport(
    '094XXXX',
    { command: 'push_status' } as BambuPrintBlock,
    undefined,
    { printerId: 'db-uuid-xyz' },
  );
  assert.equal(s.printerId, 'db-uuid-xyz');
  assert.equal(s.serialNumber, '094XXXX');
});

// ───────────────────────────────────────────────────────────────────────────
// Phase E1 — Fixture-driven Tests gegen die 5 echten __fixtures__/bambu-*.json
// Status-Mapper läuft hier nicht nur gegen Mini-Block-Konstrukte, sondern
// gegen reale-aussehende Bambu-Push-Status-Payloads.
// ───────────────────────────────────────────────────────────────────────────

test('Fixture bambu-idle: Status wird gebaut, gcodeState=IDLE, online ahb/rfid', () => {
  const fix = loadFixture('bambu-idle.json');
  const { block, device } = extractBlock(fix);
  const status = buildPrinterStatusFromBambuReport('094XXXX', block, device);
  assert.equal(status.serialNumber, '094XXXX');
  assert.equal(status.gcodeState, 'IDLE');
  assert.equal(status.printProgress, 0);
  assert.equal(status.nozzleTemp, 24.5);
  assert.equal(status.bedTemp, 23.1);
  assert.equal(status.chamberTemp, 22.0);
  assert.equal(status.wifiSignal, -53);
  assert.equal(status.chamberLight, true);
  assert.equal(status.workLight, false);
  assert.equal(status.ahbOnline, true);
  assert.equal(status.rfidOnline, true);
});

test('Fixture bambu-running: Status mit aktivem Druck, alle Standardfelder durchgereicht', () => {
  const fix = loadFixture('bambu-running.json');
  const { block, device } = extractBlock(fix);
  const status = buildPrinterStatusFromBambuReport('094XXXX', block, device);
  assert.equal(status.gcodeState, 'RUNNING');
  assert.equal(status.printProgress, 42);
  assert.equal(status.remainingTime, 73);
  assert.equal(status.layer, 84);
  assert.equal(status.totalLayers, 198);
  assert.equal(status.nozzleTemp, 215.4);
  assert.equal(status.nozzleTargetTemp, 220);
  assert.equal(status.bedTemp, 60.2);
  assert.equal(status.bedTargetTemp, 60);
  assert.equal(status.chamberTemp, 32.1);
  // subtask_name wins über gcode_file
  assert.equal(status.currentFile, 'BENCHY_PLA_RED_v3.gcode');
  assert.equal(status.chamberLight, true);
});

test('Fixture bambu-ams: AMS-Block wird in flache units/trays gemappt (1 Unit, 4 Trays)', () => {
  const fix = loadFixture('bambu-ams.json');
  const { block, device } = extractBlock(fix);
  const status = buildPrinterStatusFromBambuReport('094XXXX', block, device);
  assert.ok(status.ams, 'ams sollte gesetzt sein');
  assert.equal(status.ams!.units?.length, 1);
  assert.equal(status.ams!.units?.[0].id, 0);
  // parseIntOrUndef("24.6") → 24 (kein Float-Parse für AMS-Unit-Temp im Mapper)
  assert.equal(status.ams!.units?.[0].temp, 24);
  assert.equal(status.ams!.units?.[0].humidity, 3);
  // 4 Trays insgesamt — auch leere zählen
  assert.equal(status.ams!.trays?.length, 4);
  // Erstes Tray: PLA, rot
  const tray0 = status.ams!.trays?.find((t) => t.unitId === 0 && t.slot === 0);
  assert.ok(tray0, 'tray slot 0 muss existieren');
  assert.equal(tray0!.type, 'PLA');
  assert.equal(tray0!.color, 'FF0000FF');
  assert.equal(tray0!.remain, 87);
  // Bits aus String geparst
  assert.equal(status.ams!.amsExistBits, 1);
  // tray_now="1" → numeric
  assert.equal(status.ams!.trayNow, 1);
});

test('Fixture bambu-paused-with-hms: HMS-Array kommt als rohe Numbers durch (attr/code)', () => {
  const fix = loadFixture('bambu-paused-with-hms.json');
  const { block, device } = extractBlock(fix);
  const status = buildPrinterStatusFromBambuReport('094XXXX', block, device);
  assert.equal(status.gcodeState, 'PAUSE');
  assert.equal(status.printProgress, 88);
  assert.equal(status.remainingTime, 12);
  assert.equal(status.printError, 50348044);
  assert.equal(status.stgCur, 6);
  // wifi_signal als String "-66dBm" → -66
  assert.equal(status.wifiSignal, -66);
  // HMS — drei Einträge laut Fixture
  assert.ok(Array.isArray(status.hms));
  assert.equal(status.hms!.length, 3);
  assert.equal(typeof status.hms![0].attr, 'number');
  assert.equal(typeof status.hms![0].code, 'number');
  assert.equal(status.hms![0].attr, 50331904);
  assert.equal(status.hms![0].code, 65543);
  assert.equal(status.hms![0].action, 0);
});

test('Fixture bambu-delta-partial: Partial-Update setzt nur vorhandene Felder, Rest auf Defaults', () => {
  const fix = loadFixture('bambu-delta-partial.json');
  const { block, device } = extractBlock(fix);
  const status = buildPrinterStatusFromBambuReport('094XXXX', block, device);
  assert.equal(status.serialNumber, '094XXXX');
  // Fixture enthält nur mc_percent=43 — gcode_state fehlt → Default 'IDLE'
  assert.equal(status.printProgress, 43);
  assert.equal(status.gcodeState, 'IDLE');
  // Numerik-Defaults (numOrZero) für nicht gesendete Felder
  assert.equal(status.nozzleTemp, 0);
  assert.equal(status.bedTemp, 0);
  assert.equal(status.remainingTime, 0);
});
