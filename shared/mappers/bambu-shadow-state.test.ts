/**
 * Tests for the Bambu shadow-state / state-merge layer.
 * Uses Node's built-in test runner – no Jest dependency in shared/.
 *
 * Run via:
 *   npx ts-node --transpile-only shared/mappers/bambu-shadow-state.test.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  createEmptyShadowState,
  getStateAgeSeconds,
  isShadowStateStale,
  mapMergedBambuStateToEvents,
  mergeBambuReportIntoShadowState,
  __test,
  type BambuShadowState,
  type BambuShadowStateContext,
} from './bambu-shadow-state';
import type { BambuReportPayload } from './bambu-event-mapper';

// ─── Test-Helpers ───────────────────────────────────────────────────────────

const FIXTURE_DIR = path.join(__dirname, '__fixtures__');
const loadFixture = (name: string): BambuReportPayload =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as BambuReportPayload;

const baseCtx = (over: Partial<BambuShadowStateContext> = {}): BambuShadowStateContext => ({
  serial: '01P00A000000001',
  timestamp: '2026-04-30T12:00:00.000Z',
  source: 'bridge.lan',
  modelClass: 'safe',
  ...over,
});

// ─── Helpers (white-box) ────────────────────────────────────────────────────

test('deepMerge: undefined in delta keeps previous, null replaces', () => {
  const out = __test.deepMerge(
    { a: 1, b: 2, c: { x: 1 } },
    { a: undefined, b: null, c: { y: 2 } },
  );
  assert.deepEqual(out, { a: 1, b: null, c: { x: 1, y: 2 } });
});

test('deepMerge: arrays without ids replace, arrays with ids merge', () => {
  // Replace
  assert.deepEqual(__test.deepMerge([1, 2, 3], [9]), [9]);
  // Tray-merge per id
  const merged = __test.deepMerge(
    [{ id: '0', color: 'FF0000' }, { id: '1', color: '00FF00' }],
    [{ id: '0', remain: 50 }],
  );
  assert.deepEqual(merged, [
    { id: '0', color: 'FF0000', remain: 50 },
    { id: '1', color: '00FF00' },
  ]);
});

test('looksLikeFullState: msg=0 OR four core fields', () => {
  assert.equal(__test.looksLikeFullState({ msg: 0 }), true);
  assert.equal(
    __test.looksLikeFullState({
      gcode_state: 'IDLE',
      nozzle_temper: 24,
      bed_temper: 22,
      mc_percent: 0,
    }),
    true,
  );
  // Reines Delta
  assert.equal(__test.looksLikeFullState({ mc_percent: 42 }), false);
});

test('extractPrintBlock: tolerates wrapper, raw block, null', () => {
  assert.deepEqual(__test.extractPrintBlock({ print: { gcode_state: 'IDLE' } }), {
    gcode_state: 'IDLE',
  });
  assert.deepEqual(__test.extractPrintBlock({ gcode_state: 'IDLE' } as BambuReportPayload), {
    gcode_state: 'IDLE',
  });
  assert.deepEqual(__test.extractPrintBlock(null as unknown as BambuReportPayload), {});
});

// ─── createEmptyShadowState ────────────────────────────────────────────────

test('createEmptyShadowState seeds serial and timestamps', () => {
  const s = createEmptyShadowState('01P00A000000001', { timestamp: '2026-04-30T12:00:00.000Z' });
  assert.equal(s.serial, '01P00A000000001');
  assert.equal(s.firstSeenAt, '2026-04-30T12:00:00.000Z');
  assert.equal(s.updates, 0);
  assert.equal(s.hasFullState, false);
});

// ─── Full-State + Delta mc_percent → AMS bleibt erhalten ───────────────────

test('full-state then delta mc_percent: AMS, trays, lights survive', () => {
  // Step 1: Full-State mit AMS.
  const full = loadFixture('bambu-ams.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());
  assert.equal(r1.wasFullState, true);
  assert.ok(r1.state.merged.ams, 'AMS should be present after full state');
  assert.equal(Array.isArray(r1.state.merged.ams!.ams), true);
  const trayCountAfterFull = r1.state.merged.ams!.ams![0]!.tray!.length;
  assert.equal(trayCountAfterFull, 4);

  // Step 2: Delta mit nur mc_percent.
  const delta: BambuReportPayload = { print: { mc_percent: 42 } };
  const r2 = mergeBambuReportIntoShadowState(
    r1.state,
    delta,
    baseCtx({ timestamp: '2026-04-30T12:00:05.000Z' }),
  );
  assert.equal(r2.wasFullState, false);
  assert.equal(r2.state.merged.mc_percent, 42);
  // AMS UND Trays UND Lights bleiben:
  assert.ok(r2.state.merged.ams, 'AMS must survive delta');
  assert.equal(r2.state.merged.ams!.tray_now, '1');
  assert.equal(r2.state.merged.ams!.ams![0]!.tray!.length, 4);
  // Externer Tray bleibt:
  assert.ok(r2.state.merged.vt_tray, 'vt_tray must survive delta');
});

// ─── Full-State + Delta cooling_fan_speed → Temperaturen erhalten ─────────

test('full-state then delta cooling_fan_speed: temperatures, gcode_state, ams remain', () => {
  const full = loadFixture('bambu-running.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());
  assert.equal(r1.state.merged.nozzle_temper, 215.4);
  assert.equal(r1.state.merged.bed_temper, 60.2);
  assert.equal(r1.state.merged.gcode_state, 'RUNNING');

  const delta: BambuReportPayload = { print: { cooling_fan_speed: '4' } };
  const r2 = mergeBambuReportIntoShadowState(
    r1.state,
    delta,
    baseCtx({ timestamp: '2026-04-30T12:00:05.000Z' }),
  );
  assert.equal(r2.state.merged.cooling_fan_speed, '4');
  assert.equal(r2.state.merged.nozzle_temper, 215.4);
  assert.equal(r2.state.merged.bed_temper, 60.2);
  assert.equal(r2.state.merged.gcode_state, 'RUNNING');
  assert.equal(r2.state.merged.subtask_name, 'BENCHY_PLA_RED_v3.gcode');
});

// ─── AMS tray delta für einen Slot → andere Slots bleiben erhalten ────────

test('AMS tray delta for slot 0 keeps slot 1, vt_tray, units intact', () => {
  const full = loadFixture('bambu-ams.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());

  const slot1Before = r1.state.merged.ams!.ams![0]!.tray!.find(t => t.id === '1');
  assert.ok(slot1Before);
  assert.equal(slot1Before!.tray_type, 'PETG');

  // Nur slot 0 mit neuer remain.
  const delta: BambuReportPayload = {
    print: {
      ams: {
        ams: [
          {
            id: '0',
            tray: [
              { id: '0', remain: 12 },
            ],
          },
        ],
      },
    },
  };
  const r2 = mergeBambuReportIntoShadowState(
    r1.state,
    delta,
    baseCtx({ timestamp: '2026-04-30T12:00:10.000Z' }),
  );

  const trays = r2.state.merged.ams!.ams![0]!.tray!;
  // Reihenfolge nach Tray-IDs muss erhalten bleiben.
  assert.equal(trays.length, 4);
  const slot0After = trays.find(t => t.id === '0');
  const slot1After = trays.find(t => t.id === '1');
  // Slot 0: remain überschrieben, andere Felder erhalten.
  assert.equal(slot0After!.remain, 12);
  assert.equal(slot0After!.tray_type, 'PLA');
  assert.equal(slot0After!.tray_color, 'FF0000FF');
  // Slot 1 unverändert.
  assert.equal(slot1After!.tray_type, 'PETG');
  assert.equal(slot1After!.remain, 64);
  // tray_now bleibt:
  assert.equal(r2.state.merged.ams!.tray_now, '1');
  // External tray bleibt:
  assert.equal(r2.state.merged.vt_tray!.tray_type, 'ABS');
});

// ─── Null/empty payload → no crash, defensive state ───────────────────────

test('null/undefined payload: no crash, state.lastSeenAt does not advance', () => {
  const full = loadFixture('bambu-idle.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());

  const r2 = mergeBambuReportIntoShadowState(
    r1.state,
    null,
    baseCtx({ timestamp: '2026-04-30T12:00:30.000Z' }),
  );
  assert.equal(r2.changed, false);
  assert.equal(r2.state.lastSeenAt, r1.state.lastSeenAt); // not advanced
  assert.equal(r2.state.merged.gcode_state, 'IDLE');

  const r3 = mergeBambuReportIntoShadowState(
    r1.state,
    undefined,
    baseCtx({ timestamp: '2026-04-30T12:00:30.000Z' }),
  );
  assert.equal(r3.changed, false);
});

test('empty object payload does not throw and is no-op for merged', () => {
  const full = loadFixture('bambu-idle.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());
  const r2 = mergeBambuReportIntoShadowState(
    r1.state,
    {} as BambuReportPayload,
    baseCtx({ timestamp: '2026-04-30T12:00:05.000Z' }),
  );
  // lastSeenAt advances (we got a frame), but content unchanged.
  assert.equal(r2.state.lastSeenAt, '2026-04-30T12:00:05.000Z');
  assert.equal(r2.state.merged.gcode_state, 'IDLE');
});

// ─── Stale > 30s ───────────────────────────────────────────────────────────

test('isShadowStateStale: false within 30s, true after 31s', () => {
  const full = loadFixture('bambu-idle.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());
  // 10s later
  assert.equal(
    isShadowStateStale(r1.state, { nowIso: '2026-04-30T12:00:10.000Z' }),
    false,
  );
  // 31s later
  assert.equal(
    isShadowStateStale(r1.state, { nowIso: '2026-04-30T12:00:31.000Z' }),
    true,
  );
});

test('isShadowStateStale: null state and no-update state are stale', () => {
  assert.equal(isShadowStateStale(null), true);
  const empty = createEmptyShadowState('SN', { timestamp: '2026-04-30T12:00:00.000Z' });
  assert.equal(
    isShadowStateStale(empty, { nowIso: '2026-04-30T12:00:01.000Z' }),
    true,
  );
});

test('getStateAgeSeconds returns expected delta', () => {
  const full = loadFixture('bambu-idle.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());
  assert.equal(
    getStateAgeSeconds(r1.state, '2026-04-30T12:00:45.000Z'),
    45,
  );
});

// ─── H2C/Vortek-artige Felder bleiben erhalten ────────────────────────────

test('unknown / experimental fields (H2C/Vortek-style) survive merge but are not interpreted', () => {
  // H2D-artiges device.* Block + komplett unbekannte Felder.
  const initial: BambuReportPayload = {
    print: {
      msg: 0,
      gcode_state: 'IDLE',
      nozzle_temper: 25,
      bed_temper: 22,
      mc_percent: 0,
      // Experimental / unknown payload-Teile:
      device: {
        bed: { info: { temp: 6553700 }, state: 2 },
        extruder: { info: [{ id: 0, temp: 14418140 }, { id: 1, temp: 5767327 }] },
      },
      vortek_secret_field: { foo: 'bar', count: 1 },
    } as Record<string, unknown>,
  };

  const r1 = mergeBambuReportIntoShadowState(null, initial, baseCtx({ modelClass: 'experimental' }));
  // Felder roh erhalten:
  const merged = r1.state.merged as Record<string, unknown>;
  assert.ok(merged.device);
  assert.ok(merged.vortek_secret_field);

  // Delta auf einem unbekannten Subfeld → soll mergen, nicht ersetzen.
  const delta: BambuReportPayload = {
    print: {
      vortek_secret_field: { count: 2 },
      device: { extruder: { info: [{ id: 0, temp: 14418200 }] } },
    } as Record<string, unknown>,
  };
  const r2 = mergeBambuReportIntoShadowState(
    r1.state,
    delta,
    baseCtx({ timestamp: '2026-04-30T12:00:05.000Z', modelClass: 'experimental' }),
  );
  const merged2 = r2.state.merged as Record<string, unknown>;
  // Object-Merge:
  assert.deepEqual(merged2.vortek_secret_field, { foo: 'bar', count: 2 });
  // Tray-/Slot-artiges Array mit `id` wird per id gemerged:
  const dev = merged2.device as { extruder: { info: Array<{ id: number; temp: number }> } };
  const ext = dev.extruder.info;
  const e0 = ext.find(e => e.id === 0)!;
  const e1 = ext.find(e => e.id === 1)!;
  assert.equal(e0.temp, 14418200); // updated
  assert.equal(e1.temp, 5767327); // preserved
});

// ─── Full-State after Delta wipes correctly ───────────────────────────────

test('full-state replaces previous merged state (no leftover delta-only fields)', () => {
  // Erst delta (heuristisch kein Full-State).
  const delta: BambuReportPayload = { print: { mc_percent: 42, layer_num: 7 } };
  const r1 = mergeBambuReportIntoShadowState(null, delta, baseCtx());
  assert.equal(r1.state.hasFullState, false);
  assert.equal(r1.state.merged.mc_percent, 42);
  assert.equal(r1.state.merged.layer_num, 7);

  // Dann Full-State (msg=0) ohne layer_num.
  const full: BambuReportPayload = {
    print: {
      msg: 0,
      gcode_state: 'IDLE',
      mc_percent: 0,
      nozzle_temper: 24,
      bed_temper: 22,
    },
  };
  const r2 = mergeBambuReportIntoShadowState(r1.state, full, baseCtx({
    timestamp: '2026-04-30T12:00:05.000Z',
  }));
  assert.equal(r2.wasFullState, true);
  assert.equal(r2.state.hasFullState, true);
  assert.equal(r2.state.merged.mc_percent, 0);
  assert.equal(r2.state.merged.layer_num, undefined); // wiped
});

// ─── Integration mit Mapper ───────────────────────────────────────────────

test('mapMergedBambuStateToEvents uses mapper and reports stale flag', () => {
  const full = loadFixture('bambu-running.json');
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());

  // Fresh: nicht stale
  const fresh = mapMergedBambuStateToEvents(r1.state, {
    printerId: 'p-1',
    workspaceId: 'ws-1',
    bridgeId: 'br-1',
    source: 'bridge.lan',
    timestamp: '2026-04-30T12:00:10.000Z',
  });
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.telemetry.kind, 'telemetry');
  assert.equal(fresh.telemetry.lifecycle, 'printing');
  assert.equal(fresh.telemetry.progress.jobName, 'BENCHY_PLA_RED_v3.gcode');

  // Stale: same state, 60s later
  const stale = mapMergedBambuStateToEvents(r1.state, {
    printerId: 'p-1',
    workspaceId: 'ws-1',
    bridgeId: 'br-1',
    source: 'bridge.lan',
    timestamp: '2026-04-30T12:01:00.000Z',
  });
  assert.equal(stale.isStale, true);
});

test('mapMergedBambuStateToEvents survives a delta-only merged state', () => {
  // Delta ohne Full-State darf nicht crashen, isStale=true (kein Full seen).
  const delta: BambuReportPayload = { print: { mc_percent: 10 } };
  const r1 = mergeBambuReportIntoShadowState(null, delta, baseCtx());
  const out = mapMergedBambuStateToEvents(r1.state, {
    printerId: 'p-1',
    workspaceId: 'ws-1',
    bridgeId: null,
    source: 'bridge.lan',
    timestamp: '2026-04-30T12:00:05.000Z',
  });
  assert.equal(out.telemetry.kind, 'telemetry');
  // Lifecycle bleibt 'unknown' weil gcode_state fehlt – Konsumenten sehen das + isStale.
  assert.equal(out.telemetry.lifecycle, 'unknown');
});

// ─── Sequence-ID + updates counter ────────────────────────────────────────

test('updates counter and lastSequenceId track frames', () => {
  const full: BambuReportPayload = { print: { msg: 0, sequence_id: '100', gcode_state: 'IDLE', nozzle_temper: 24, bed_temper: 22, mc_percent: 0 } };
  const r1 = mergeBambuReportIntoShadowState(null, full, baseCtx());
  assert.equal(r1.state.updates, 1);
  assert.equal(r1.state.lastSequenceId, '100');
  const r2 = mergeBambuReportIntoShadowState(
    r1.state,
    { print: { mc_percent: 5, sequence_id: '101' } } as BambuReportPayload,
    baseCtx({ timestamp: '2026-04-30T12:00:05.000Z' }),
  );
  assert.equal(r2.state.updates, 2);
  assert.equal(r2.state.lastSequenceId, '101');
});
