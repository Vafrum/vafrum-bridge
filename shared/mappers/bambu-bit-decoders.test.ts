/**
 * Tests for Bambu bit-field decoders.
 * Uses Node's built-in test runner (`node:test`) – no Jest dependency in shared/.
 *
 * Run via:
 *   npx ts-node --transpile-only shared/mappers/bambu-bit-decoders.test.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { decodeHomeFlag, decodeBitPositions } from './bambu-bit-decoders';

test('decodeHomeFlag: Door-Open Bit gesetzt', () => {
  const result = decodeHomeFlag(0x00800000);
  assert.equal(result.doorOpen, true);
  assert.equal(result.filamentTangle, false);
});

test('decodeHomeFlag: Filament-Tangle Bit gesetzt', () => {
  const result = decodeHomeFlag(0x00100000);
  assert.equal(result.doorOpen, false);
  assert.equal(result.filamentTangle, true);
});

test('decodeHomeFlag: beide Bits gesetzt', () => {
  const result = decodeHomeFlag(0x00900000);
  assert.equal(result.doorOpen, true);
  assert.equal(result.filamentTangle, true);
});

test('decodeHomeFlag: keine Bits gesetzt', () => {
  const result = decodeHomeFlag(0);
  assert.equal(result.doorOpen, false);
  assert.equal(result.filamentTangle, false);
});

test('decodeHomeFlag: null und undefined → alle false', () => {
  assert.equal(decodeHomeFlag(null).doorOpen, false);
  assert.equal(decodeHomeFlag(undefined).doorOpen, false);
});

test('decodeHomeFlag: Hex-String akzeptiert', () => {
  const result = decodeHomeFlag('0x00800000');
  assert.equal(result.doorOpen, true);
});

test('decodeHomeFlag: raw-Wert wird zurückgegeben', () => {
  const result = decodeHomeFlag(0x00800000);
  assert.equal(result.raw, 0x00800000);
});

test('decodeBitPositions: Standard-Beispiel 0b1011 → [0, 1, 3]', () => {
  assert.deepEqual(decodeBitPositions(0b1011), [0, 1, 3]);
});

test('decodeBitPositions: 0 → leeres Array', () => {
  assert.deepEqual(decodeBitPositions(0), []);
});

test('decodeBitPositions: alle ersten 4 Bits → [0, 1, 2, 3]', () => {
  assert.deepEqual(decodeBitPositions(0b1111), [0, 1, 2, 3]);
});

test('decodeBitPositions: nur höhere Bits 0b10000000 → [7]', () => {
  assert.deepEqual(decodeBitPositions(0b10000000), [7]);
});

test('decodeBitPositions: null → leeres Array', () => {
  assert.deepEqual(decodeBitPositions(null), []);
});

test('decodeBitPositions: maxBits begrenzt — 0b1111 mit maxBits=2 → [0, 1]', () => {
  assert.deepEqual(decodeBitPositions(0b1111, 2), [0, 1]);
});

test('decodeBitPositions: AMS-Beispiel 0b00000011 → 2 AMS-Units (Position 0 und 1)', () => {
  assert.deepEqual(decodeBitPositions(0x03), [0, 1]);
});
