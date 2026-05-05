import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatHmsCode,
  buildHmsWikiUrl,
  getHmsModule,
  getHmsSeverity,
  getHmsDescription,
  enrichHmsEntry,
  mapHmsArray,
} from './bambu-hms-enricher';

// ─── formatHmsCode ──────────────────────────────────────────────────────────

test('formatHmsCode: Standard-Beispiel', () => {
  assert.equal(formatHmsCode(0x05000300, 0x00010001), '0500_0300_0001_0001');
});

test('formatHmsCode: führende Nullen werden gepadded', () => {
  assert.equal(formatHmsCode(0, 1), '0000_0000_0000_0001');
});

test('formatHmsCode: maximale Werte', () => {
  assert.equal(formatHmsCode(0xffffffff, 0xffffffff), 'FFFF_FFFF_FFFF_FFFF');
});

test('formatHmsCode: realer DB-Code 0300_0100_0001_0007', () => {
  // attr = 0x03000100, code = 0x00010007
  assert.equal(formatHmsCode(0x03000100, 0x00010007), '0300_0100_0001_0007');
});

// ─── buildHmsWikiUrl ────────────────────────────────────────────────────────

test('buildHmsWikiUrl: Direkt-Pfad zum Troubleshooting-Eintrag', () => {
  assert.equal(
    buildHmsWikiUrl('0500_0300_0001_0001'),
    'https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/0500_0300_0001_0001',
  );
});

// ─── getHmsModule ───────────────────────────────────────────────────────────

test('getHmsModule: bekannte IDs', () => {
  assert.equal(getHmsModule(0x03000000), 'motion_controller');
  assert.equal(getHmsModule(0x05000000), 'mainboard');
  assert.equal(getHmsModule(0x07000000), 'ams');
  assert.equal(getHmsModule(0x08000000), 'toolhead');
  assert.equal(getHmsModule(0x0c000000), 'camera');
  assert.equal(getHmsModule(0x12000000), 'ams_lite');
  assert.equal(getHmsModule(0x18000000), 'ams_ht');
  assert.equal(getHmsModule(0x1a000000), 'hotend_rack');
});

test('getHmsModule: unbekannte ID → unknown', () => {
  assert.equal(getHmsModule(0xff000000), 'unknown');
});

// ─── getHmsSeverity (3. Gruppe / obere 16 Bit von code) ─────────────────────

test('getHmsSeverity: bekannte Stufen aus oberen 16 Bit von code', () => {
  assert.equal(getHmsSeverity(0x00010000), 'fatal');
  assert.equal(getHmsSeverity(0x00020000), 'serious');
  assert.equal(getHmsSeverity(0x00030000), 'common');
  assert.equal(getHmsSeverity(0x00040000), 'info');
});

test('getHmsSeverity: untere 16 Bit werden ignoriert', () => {
  // code = 0x00010007 → upper = 0x0001 = 'fatal'; lower 0x0007 darf nichts ändern
  assert.equal(getHmsSeverity(0x00010007), 'fatal');
});

test('getHmsSeverity: unbekannte Stufe → common (Default)', () => {
  assert.equal(getHmsSeverity(0xffff0000), 'common');
  assert.equal(getHmsSeverity(0x00000000), 'common');
});

// ─── getHmsDescription ──────────────────────────────────────────────────────

test('getHmsDescription: unbekannter Code → undefined', () => {
  assert.equal(getHmsDescription('FFFF_FFFF_FFFF_FFFF'), undefined);
});

test('getHmsDescription: realer DB-Code liefert deutschen Text (Default)', () => {
  // 0300_0100_0001_0001 ist bekannt der erste Eintrag in beiden DBs.
  const de = getHmsDescription('0300_0100_0001_0001');
  assert.ok(typeof de === 'string' && de.length > 0, 'erwartete deutsche Description');
  assert.match(de!, /Heizbett/i);
});

test('getHmsDescription: preferLang en liefert englischen Text', () => {
  const en = getHmsDescription('0300_0100_0001_0001', 'en');
  assert.ok(typeof en === 'string' && en.length > 0);
  assert.match(en!, /heatbed/i);
});

// ─── enrichHmsEntry ─────────────────────────────────────────────────────────

test('enrichHmsEntry: Vollanreicherung synthetisches Beispiel', () => {
  const result = enrichHmsEntry({ attr: 0x05000300, code: 0x00010001 });
  assert.equal(result.formattedCode, '0500_0300_0001_0001');
  assert.equal(result.module, 'mainboard');
  assert.equal(result.severityLevel, 'fatal');
  assert.equal(
    result.wikiUrl,
    'https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/0500_0300_0001_0001',
  );
});

test('enrichHmsEntry: realer DB-Code mit Description', () => {
  // attr=0x03000100, code=0x00010001 → 0300_0100_0001_0001
  const result = enrichHmsEntry({ attr: 0x03000100, code: 0x00010001 });
  assert.equal(result.formattedCode, '0300_0100_0001_0001');
  assert.equal(result.module, 'motion_controller');
  assert.equal(result.severityLevel, 'fatal');
  assert.ok(result.description, 'erwartete Description aus DB');
  assert.match(result.description!, /Heizbett/i);
});

// ─── mapHmsArray ────────────────────────────────────────────────────────────

test('mapHmsArray: leeres und undefined → []', () => {
  assert.deepEqual(mapHmsArray([]), []);
  assert.deepEqual(mapHmsArray(undefined), []);
});

test('mapHmsArray: zwei Einträge', () => {
  const result = mapHmsArray([
    { attr: 0x05000300, code: 0x00010001 },
    { attr: 0x07000100, code: 0x00020002 },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].module, 'mainboard');
  assert.equal(result[0].severityLevel, 'fatal');
  assert.equal(result[1].module, 'ams');
  assert.equal(result[1].severityLevel, 'serious');
});
