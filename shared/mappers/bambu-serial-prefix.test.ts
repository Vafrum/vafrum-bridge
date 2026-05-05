/**
 * Read-only tests for Bambu serial-prefix model detection.
 * Uses Node's built-in test runner (`node:test`) – no Jest dependency in shared/.
 *
 * Run via:
 *   npx ts-node --transpile-only shared/mappers/bambu-serial-prefix.test.ts
 */

import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  detectModelBySerial,
  getVerifiedPrefixes,
  getUnverifiedPrefixes,
  getModelsWithoutPrefix,
  isH2Family,
  isX2Family,
  isMultiExtruder,
  getFamilyClass,
} from './bambu-serial-prefix';

test('detectModelBySerial: 01S-Präfix → X1C', () => {
  const info = detectModelBySerial('01S00ABC123');
  assert.equal(info.model, 'X1C');
  assert.equal(info.family, 'X1');
  assert.equal(info.class, 'safe');
});

test('detectModelBySerial: 00M-Präfix → P1P', () => {
  const info = detectModelBySerial('00M00ABC123');
  assert.equal(info.model, 'P1P');
  assert.equal(info.family, 'P1');
  assert.equal(info.class, 'safe');
});

test('detectModelBySerial: 039-Präfix → A1 mini', () => {
  const info = detectModelBySerial('039XYZ');
  assert.equal(info.model, 'A1 mini');
  assert.equal(info.family, 'A1');
  assert.equal(info.class, 'safe');
});

test('detectModelBySerial: 094-Präfix → A1 (nicht A1 mini, Reihenfolge-Test)', () => {
  const info = detectModelBySerial('094XYZ');
  assert.equal(info.model, 'A1');
  assert.equal(info.family, 'A1');
  assert.equal(info.class, 'safe');
});

test('detectModelBySerial: unbekannter Präfix → unknown', () => {
  const info = detectModelBySerial('UNKNOWNXYZ');
  assert.equal(info.model, 'unknown');
  assert.equal(info.family, 'unknown');
  assert.equal(info.class, 'unknown');
});

test('detectModelBySerial: case-insensitive (lowercase Input)', () => {
  const info = detectModelBySerial('01s00abc');
  assert.equal(info.model, 'X1C');
});

test('detectModelBySerial: trimmt Whitespace', () => {
  const info = detectModelBySerial('  01S00  ');
  assert.equal(info.model, 'X1C');
});

test('detectModelBySerial: leerer String → unknown', () => {
  const info = detectModelBySerial('');
  assert.equal(info.model, 'unknown');
});

test('detectModelBySerial: realer A1-mini Trace (PROJEKTANALYSE.md)', () => {
  // 03919D511001688, 03919A3B2101282 → A1 mini
  assert.equal(detectModelBySerial('03919D511001688').model, 'A1 mini');
  assert.equal(detectModelBySerial('03919A3B2101282').model, 'A1 mini');
});

test('detectModelBySerial: realer A1-Trace (PROJEKTANALYSE.md)', () => {
  // 0948BB522100521 → A1
  assert.equal(detectModelBySerial('0948BB522100521').model, 'A1');
});

test('detectModelBySerial: 03W-Präfix → X1E', () => {
  const info = detectModelBySerial('03W00ABC');
  assert.equal(info.model, 'X1E');
});

test('detectModelBySerial: 01P-Präfix → P1S', () => {
  const info = detectModelBySerial('01P00ABC');
  assert.equal(info.model, 'P1S');
});

test('getVerifiedPrefixes: aktuell leer (alle community-stamm)', () => {
  const verified = getVerifiedPrefixes();
  assert.equal(verified.length, 0);
});

test('getUnverifiedPrefixes: enthält alle aktuellen Tabellen-Einträge', () => {
  const unverified = getUnverifiedPrefixes();
  assert.ok(unverified.length >= 7); // 01S, 00W, 03W, 00M, 01P, 039, 094
  for (const e of unverified) {
    assert.equal(e.verified, false);
  }
});

test('getModelsWithoutPrefix: enthält Modelle ohne Tabellen-Eintrag', () => {
  const missing = getModelsWithoutPrefix();
  // Aktuell ohne Präfix-Eintrag: P2S, H2D, H2D Pro, H2C, H2S, X2D
  assert.ok(missing.includes('P2S'));
  assert.ok(missing.includes('H2D'));
  assert.ok(missing.includes('H2D Pro'));
  assert.ok(missing.includes('H2C'));
  assert.ok(missing.includes('H2S'));
  assert.ok(missing.includes('X2D'));
});

test('isH2Family: H2D, H2D Pro, H2C, H2S → true', () => {
  assert.equal(isH2Family('H2D'), true);
  assert.equal(isH2Family('H2D Pro'), true);
  assert.equal(isH2Family('H2C'), true);
  assert.equal(isH2Family('H2S'), true);
});

test('isH2Family: andere Modelle → false', () => {
  assert.equal(isH2Family('X1C'), false);
  assert.equal(isH2Family('A1'), false);
  assert.equal(isH2Family('X2D'), false);
  assert.equal(isH2Family('unknown'), false);
});

test('isX2Family: X2D → true, andere → false', () => {
  assert.equal(isX2Family('X2D'), true);
  assert.equal(isX2Family('H2D'), false);
  assert.equal(isX2Family('X1C'), false);
});

test('isMultiExtruder: H2-Familie und X2-Familie → true', () => {
  assert.equal(isMultiExtruder('H2D'), true);
  assert.equal(isMultiExtruder('H2C'), true);
  assert.equal(isMultiExtruder('X2D'), true);
  assert.equal(isMultiExtruder('X1C'), false);
  assert.equal(isMultiExtruder('A1'), false);
});

test('getFamilyClass: H2/X2 → experimental, X1/P1/P2/A1 → safe, unknown → unknown', () => {
  assert.equal(getFamilyClass('H2'), 'experimental');
  assert.equal(getFamilyClass('X2'), 'experimental');
  assert.equal(getFamilyClass('X1'), 'safe');
  assert.equal(getFamilyClass('P1'), 'safe');
  assert.equal(getFamilyClass('P2'), 'safe');
  assert.equal(getFamilyClass('A1'), 'safe');
  assert.equal(getFamilyClass('unknown'), 'unknown');
});
