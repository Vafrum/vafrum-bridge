/**
 * Tests for Bambu H2-family multi-extruder temperature decoder.
 * Uses Node's built-in test runner (`node:test`).
 *
 * Run via:
 *   npx ts-node --transpile-only shared/mappers/bambu-h2-device-decoder.test.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { decodePackedTemp, decodeExtruderInfo } from './bambu-h2-device-decoder';

test('decodePackedTemp: aktuell 220, target 220 → packed 0x00DC00DC', () => {
  // Low = 220, High = 220, packed = (220 << 16) | 220 = 14418140
  const packed = (220 << 16) | 220;
  const result = decodePackedTemp(packed);
  assert.equal(result.current, 220);
  assert.equal(result.target, 220);
  assert.equal(result.isZero, false);
});

test('decodePackedTemp: aktuell 25, target 0 (Heizung aus) → isZero false', () => {
  const packed = (0 << 16) | 25;
  const result = decodePackedTemp(packed);
  assert.equal(result.current, 25);
  assert.equal(result.target, 0);
  assert.equal(result.isZero, false);
});

test('decodePackedTemp: 0/0 → isZero true', () => {
  const result = decodePackedTemp(0);
  assert.equal(result.current, 0);
  assert.equal(result.target, 0);
  assert.equal(result.isZero, true);
});

test('decodePackedTemp: null → isZero true, alle 0', () => {
  const result = decodePackedTemp(null);
  assert.equal(result.current, 0);
  assert.equal(result.target, 0);
  assert.equal(result.isZero, true);
});

test('decodePackedTemp: undefined → isZero true', () => {
  const result = decodePackedTemp(undefined);
  assert.equal(result.isZero, true);
});

test('decodePackedTemp: numerischer String akzeptiert', () => {
  const packed = ((220 << 16) | 220).toString();
  const result = decodePackedTemp(packed);
  assert.equal(result.current, 220);
  assert.equal(result.target, 220);
});

test('decodePackedTemp: leerer String → isZero true', () => {
  const result = decodePackedTemp('');
  assert.equal(result.isZero, true);
});

test('decodePackedTemp: ungültiger String → isZero true', () => {
  const result = decodePackedTemp('XYZ');
  assert.equal(result.isZero, true);
});

test('decodePackedTemp: negative Low-Word-Temperatur (z.B. -10)', () => {
  // Low = -10 (0xFFF6 als signed 16-bit), High = 0
  const packed = (0 << 16) | 0xfff6;
  const result = decodePackedTemp(packed);
  assert.equal(result.current, -10);
  assert.equal(result.target, 0);
});

test('decodePackedTemp: raw-Wert wird zurückgegeben', () => {
  const packed = (220 << 16) | 220;
  const result = decodePackedTemp(packed);
  assert.equal(result.raw, packed);
});

test('decodeExtruderInfo: H2D Dual-Extruder Beispiel', () => {
  const input = [
    { temp: (220 << 16) | 215 },  // Nozzle 1: aktuell 215, target 220
    { temp: (210 << 16) | 0 },    // Nozzle 2: aktuell 0, target 210
  ];
  const result = decodeExtruderInfo(input);
  assert.equal(result.length, 2);
  assert.equal(result[0].current, 215);
  assert.equal(result[0].target, 220);
  assert.equal(result[1].current, 0);
  assert.equal(result[1].target, 210);
});

test('decodeExtruderInfo: leeres Array', () => {
  assert.deepEqual(decodeExtruderInfo([]), []);
});

test('decodeExtruderInfo: kein Array → leeres Array', () => {
  assert.deepEqual(decodeExtruderInfo(null), []);
  assert.deepEqual(decodeExtruderInfo(undefined), []);
  assert.deepEqual(decodeExtruderInfo({}), []);
});

test('decodeExtruderInfo: Eintrag ohne temp-Feld → isZero', () => {
  const result = decodeExtruderInfo([{ other: 'field' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].isZero, true);
});
