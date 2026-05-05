/**
 * Tests for Bambu hex decoders (stat, fun).
 * Uses Node's built-in test runner (`node:test`).
 *
 * Run via:
 *   npx ts-node --transpile-only shared/mappers/bambu-hex-decoders.test.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { decodeFun, decodeStat } from './bambu-hex-decoders';

test('decodeFun: 3EC1AFFF — Bit gesetzt', () => {
  const result = decodeFun('3EC1AFFF');
  assert.equal(result.developerModeBitSet, true);
  assert.equal(result.rawHex, '3EC1AFFF');
});

test('decodeFun: 3EC18FFF — Bit nicht gesetzt', () => {
  const result = decodeFun('3EC18FFF');
  assert.equal(result.developerModeBitSet, false);
  assert.equal(result.rawHex, '3EC18FFF');
});

test('decodeFun: 0x-Präfix akzeptiert', () => {
  const result = decodeFun('0x3EC1AFFF');
  assert.equal(result.developerModeBitSet, true);
});

test('decodeFun: lowercase Hex', () => {
  const result = decodeFun('3ec1afff');
  assert.equal(result.developerModeBitSet, true);
  assert.equal(result.rawHex, '3EC1AFFF');
});

test('decodeFun: numeric Input akzeptiert', () => {
  const result = decodeFun(0x3EC1AFFF);
  assert.equal(result.developerModeBitSet, true);
});

test('decodeFun: null → alles 0/false', () => {
  const result = decodeFun(null);
  assert.equal(result.developerModeBitSet, false);
  assert.equal(result.raw, 0);
  assert.equal(result.rawHex, '0');
});

test('decodeFun: undefined → alles 0/false', () => {
  const result = decodeFun(undefined);
  assert.equal(result.raw, 0);
});

test('decodeFun: leerer String → 0', () => {
  const result = decodeFun('');
  assert.equal(result.raw, 0);
});

test('decodeFun: ungültige Hex → 0', () => {
  const result = decodeFun('XYZ');
  assert.equal(result.raw, 0);
});

test('decodeStat: einfacher Hex-Wert', () => {
  const result = decodeStat('1A');
  assert.equal(result.raw, 0x1A);
  assert.equal(result.rawHex, '1A');
});

test('decodeStat: numeric Input', () => {
  const result = decodeStat(255);
  assert.equal(result.raw, 255);
  assert.equal(result.rawHex, 'FF');
});

test('decodeStat: null → 0', () => {
  const result = decodeStat(null);
  assert.equal(result.raw, 0);
  assert.equal(result.rawHex, '0');
});

test('decodeStat: 0x-Präfix', () => {
  const result = decodeStat('0xFF');
  assert.equal(result.raw, 255);
});
