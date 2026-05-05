/**
 * Tests for BambuBridgeCoreAdapter.
 * Uses Node's built-in test runner – no Jest dependency in shared/.
 *
 * Run via:
 *   npx ts-node --transpile-only shared/bridge/bambu-bridge-core-adapter.test.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  BambuBridgeCoreAdapter,
  type BambuPrinterConfig,
} from './bambu-bridge-core-adapter';
import type { BambuReportPayload } from '../mappers/bambu-event-mapper';

const FIXTURE_DIR = path.join(__dirname, '..', 'mappers', '__fixtures__');
const loadFixture = (name: string): BambuReportPayload =>
  JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8')) as BambuReportPayload;

const config = (over: Partial<BambuPrinterConfig> = {}): BambuPrinterConfig => ({
  serial: '01P00A000000001',
  printerId: 'p-uuid-1',
  workspaceId: 'ws-1',
  bridgeId: 'br-1',
  modelClass: 'safe',
  model: 'P1S',
  staleAfterSeconds: 30,
  ...over,
});

// ─── Register / unregister ─────────────────────────────────────────────────

test('register adds printer and unregister removes it', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config());
  assert.equal(adapter.size(), 1);
  // Health: neverSeen
  const h = adapter.getPrinterHealth('01P00A000000001');
  assert.ok(h);
  assert.equal(h!.status, 'neverSeen');
  assert.equal(h!.modelClass, 'safe');
  assert.equal(h!.lastSeenAt, null);
  assert.equal(h!.hasFullState, false);

  // Unregister
  const removed = adapter.unregisterPrinter('01P00A000000001');
  assert.equal(removed, true);
  assert.equal(adapter.size(), 0);
  assert.equal(adapter.getPrinterHealth('01P00A000000001'), null);
});

test('register validates required fields', () => {
  const adapter = new BambuBridgeCoreAdapter();
  assert.throws(() => adapter.registerPrinter({} as BambuPrinterConfig));
  assert.throws(() =>
    adapter.registerPrinter({ serial: 'X' } as BambuPrinterConfig),
  );
});

test('re-register keeps shadow state (non-destructive)', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config());
  adapter.ingestReport('01P00A000000001', loadFixture('bambu-running.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });
  const before = adapter.getShadowState('01P00A000000001');
  assert.ok(before);
  adapter.registerPrinter(config({ model: 'P1S-rev2' }));
  const after = adapter.getShadowState('01P00A000000001');
  assert.equal(after, before);
  // Config-Update wirkt (Health bleibt online):
  const h = adapter.getPrinterHealth('01P00A000000001', '2026-04-30T12:00:05.000Z');
  assert.equal(h!.status, 'online');
});

// ─── Ingest full state ─────────────────────────────────────────────────────

test('ingest full-state: events accepted, telemetry produced, health=online', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config());

  const result = adapter.ingestReport('01P00A000000001', loadFixture('bambu-running.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
    source: 'bridge.lan',
  });
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.equal(result.wasFullState, true);
  assert.equal(result.changed, true);
  // Telemetry vorhanden
  assert.equal(result.events.telemetry.kind, 'telemetry');
  assert.equal(result.events.telemetry.lifecycle, 'printing');
  assert.equal(result.events.telemetry.progress.jobName, 'BENCHY_PLA_RED_v3.gcode');
  // Health
  assert.equal(result.health.status, 'online');
  assert.equal(result.health.hasFullState, true);
  assert.equal(result.health.totalIngests, 1);
  assert.equal(result.health.totalFullStates, 1);
  // Mind. ein Event gezählt:
  assert.ok(result.health.lastIngestEventCount >= 1);
});

// ─── Ingest delta after full state ─────────────────────────────────────────

test('ingest delta after full state: AMS preserved, percent updated, totalFullStates stays', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config());
  adapter.ingestReport('01P00A000000001', loadFixture('bambu-ams.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });

  const result = adapter.ingestReport(
    '01P00A000000001',
    { print: { mc_percent: 42 } } as BambuReportPayload,
    { timestamp: '2026-04-30T12:00:05.000Z' },
  );
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') return;
  assert.equal(result.wasFullState, false);
  assert.equal(result.state.merged.mc_percent, 42);
  // AMS (volle Struktur) bleibt:
  assert.ok(result.state.merged.ams);
  assert.equal(result.state.merged.ams!.tray_now, '1');
  // Health
  assert.equal(result.health.totalIngests, 2);
  assert.equal(result.health.totalFullStates, 1);
  assert.equal(result.health.status, 'online');
});

// ─── Unknown serial ────────────────────────────────────────────────────────

test('unknown serial → rejected with printer_not_registered', () => {
  const adapter = new BambuBridgeCoreAdapter();
  const r = adapter.ingestReport('UNKNOWN-SN', loadFixture('bambu-idle.json'));
  assert.equal(r.status, 'rejected');
  if (r.status !== 'rejected') return;
  assert.equal(r.reason, 'printer_not_registered');
  assert.equal(r.health, null);
});

// ─── Null payload ──────────────────────────────────────────────────────────

test('null payload → rejected with invalid_payload, state unchanged', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config());
  adapter.ingestReport('01P00A000000001', loadFixture('bambu-idle.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });

  const r = adapter.ingestReport('01P00A000000001', null, {
    timestamp: '2026-04-30T12:00:05.000Z',
  });
  assert.equal(r.status, 'rejected');
  if (r.status !== 'rejected') return;
  assert.equal(r.reason, 'invalid_payload');
  assert.ok(r.health);
  assert.equal(r.health!.status, 'online'); // 5s alt → noch online
  assert.equal(r.health!.hasFullState, true);

  // Auch undefined und non-object dürfen nicht crashen.
  const r2 = adapter.ingestReport('01P00A000000001', undefined);
  assert.equal(r2.status, 'rejected');
  const r3 = adapter.ingestReport(
    '01P00A000000001',
    'garbage' as unknown as BambuReportPayload,
  );
  assert.equal(r3.status, 'rejected');
});

// ─── Stale ─────────────────────────────────────────────────────────────────

test('health turns stale after configured threshold', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config({ staleAfterSeconds: 30 }));
  adapter.ingestReport('01P00A000000001', loadFixture('bambu-idle.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });
  // 10s later → online
  const h1 = adapter.getPrinterHealth('01P00A000000001', '2026-04-30T12:00:10.000Z');
  assert.equal(h1!.status, 'online');
  // 31s later → stale
  const h2 = adapter.getPrinterHealth('01P00A000000001', '2026-04-30T12:00:31.000Z');
  assert.equal(h2!.status, 'stale');
});

// ─── Multi-printer isolation ───────────────────────────────────────────────

test('multiple printers tracked independently', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config({ serial: 'SN-A', printerId: 'A', model: 'A1' }));
  adapter.registerPrinter(config({ serial: 'SN-B', printerId: 'B', model: 'P1S' }));

  adapter.ingestReport('SN-A', loadFixture('bambu-idle.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });
  adapter.ingestReport('SN-B', loadFixture('bambu-running.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });

  const a = adapter.getShadowState('SN-A')!;
  const b = adapter.getShadowState('SN-B')!;
  assert.notEqual(a, b);
  assert.equal(a.merged.gcode_state, 'IDLE');
  assert.equal(b.merged.gcode_state, 'RUNNING');

  // getAllShadowStates liefert beide
  assert.equal(adapter.getAllShadowStates().length, 2);

  // Ingest auf SN-A darf SN-B nicht beeinflussen.
  adapter.ingestReport('SN-A', { print: { mc_percent: 11 } } as BambuReportPayload, {
    timestamp: '2026-04-30T12:00:05.000Z',
  });
  const bAfter = adapter.getShadowState('SN-B')!;
  assert.equal(bAfter.merged.mc_percent, 42);
  assert.equal(bAfter.merged.subtask_name, 'BENCHY_PLA_RED_v3.gcode');
});

// ─── modelClass unknown / blocked ──────────────────────────────────────────

test('modelClass=unknown still produces events but stays defensive', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config({ serial: 'SN-X', modelClass: 'unknown', model: 'H2C' }));

  const r = adapter.ingestReport('SN-X', loadFixture('bambu-running.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });
  assert.equal(r.status, 'accepted');
  if (r.status !== 'accepted') return;
  // Telemetry kommt (Mapper interpretiert nur, was er sicher kann):
  assert.equal(r.events.telemetry.kind, 'telemetry');
  assert.equal(r.health.modelClass, 'unknown');
  // State.modelClass intern = 'unknown' (kein Auto-Aufstufen auf 'safe'/'experimental')
  assert.equal(r.state.modelClass, 'unknown');
});

test('modelClass=blocked rejects ingest with model_blocked, no state mutation', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config({ serial: 'SN-BLK', modelClass: 'blocked', model: 'H2C' }));

  const before = adapter.getShadowState('SN-BLK');
  assert.equal(before, null);

  const r = adapter.ingestReport('SN-BLK', loadFixture('bambu-running.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
  });
  assert.equal(r.status, 'rejected');
  if (r.status !== 'rejected') return;
  assert.equal(r.reason, 'model_blocked');
  assert.ok(r.health);
  assert.equal(r.health!.status, 'blocked');
  assert.equal(r.health!.modelClass, 'blocked');

  // State bleibt null:
  assert.equal(adapter.getShadowState('SN-BLK'), null);
  // Aber die Ingest-Statistik zählt mit:
  assert.equal(r.health!.totalIngests, 1);
  assert.equal(r.health!.totalFullStates, 0);
});

// ─── clear ────────────────────────────────────────────────────────────────

test('clear removes all printers', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config({ serial: 'A' }));
  adapter.registerPrinter(config({ serial: 'B' }));
  assert.equal(adapter.size(), 2);
  adapter.clear();
  assert.equal(adapter.size(), 0);
  assert.equal(adapter.getAllShadowStates().length, 0);
});

// ─── Event-Ausgabe nach validem Payload ────────────────────────────────────

test('event output contains TelemetryEvent + workflow on transition', () => {
  const adapter = new BambuBridgeCoreAdapter();
  adapter.registerPrinter(config());

  const r = adapter.ingestReport('01P00A000000001', loadFixture('bambu-running.json'), {
    timestamp: '2026-04-30T12:00:00.000Z',
    previous: { lifecycle: 'idle', online: true },
  });
  assert.equal(r.status, 'accepted');
  if (r.status !== 'accepted') return;
  // Telemetry
  assert.equal(r.events.telemetry.kind, 'telemetry');
  assert.equal(r.events.telemetry.lifecycle, 'printing');
  // Workflow: print.started (durch previous.lifecycle=idle)
  const ws = r.events.workflow.find(w => w.type === 'print.started');
  assert.ok(ws, 'expected print.started workflow event');
  // Stale-Flag
  assert.equal(r.events.isStale, false);
});
