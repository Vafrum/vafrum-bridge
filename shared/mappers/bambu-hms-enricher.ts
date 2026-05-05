/**
 * HMS-Anreicherung für Bambu-Drucker — eine Wahrheitsquelle.
 *
 * Konsolidiert die zuvor parallelen Implementierungen aus
 * - shared/mappers/bambu-event-mapper.ts (formatHmsCode, mapHmsSeverity, mapHmsModule)
 * - vafrum-core-api/src/gateway/printer-status.service.ts (enrichHmsData)
 * - vafrum-core-web/src/features/print-management/lib/hms-codes.ts (decodeHms)
 *
 * Konventionen:
 *  - Severity = (code >>> 16) & 0xffff (Bambu-Konvention, 3. Gruppe im
 *    formattedCode). Default-Fallback 'common' bei unbekanntem Hex.
 *  - Module = (attr >>> 24) & 0xff (1. Gruppe), snake_case-Slugs.
 *  - Wiki-URL: Direkt-Pfad /en/x1/troubleshooting/hmscode/<code>.
 *  - Sprache Default 'de' mit Fallback auf 'en'.
 */

import hmsCodesEn from '../data/hms-codes-en.json';
import hmsCodesDe from '../data/hms-codes-de.json';
import type { HmsModule, HmsSeverity } from '../interfaces/printer-events';

const HMS_DESCRIPTIONS_EN = hmsCodesEn as Record<string, string>;
const HMS_DESCRIPTIONS_DE = hmsCodesDe as Record<string, string>;

const HMS_MODULE_BY_ID: Record<number, HmsModule> = {
  0x03: 'motion_controller',
  0x05: 'mainboard',
  0x07: 'ams',
  0x08: 'toolhead',
  0x0c: 'camera',
  0x12: 'ams_lite',
  0x18: 'ams_ht',
  0x1a: 'hotend_rack',
};

const HMS_SEVERITY_BY_HEX: Record<string, HmsSeverity> = {
  '0001': 'fatal',
  '0002': 'serious',
  '0003': 'common',
  '0004': 'info',
};

export interface EnrichedHmsEntry {
  attr: number;
  code: number;
  formattedCode: string;
  module: HmsModule;
  severityLevel: HmsSeverity;
  description?: string;
  wikiUrl: string;
}

/** attr+code → "XXXX_XXXX_XXXX_XXXX" (uppercase, 4 Gruppen à 4 Hex). */
export function formatHmsCode(attr: number, code: number): string {
  const attrHex = (attr >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const codeHex = (code >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${attrHex.slice(0, 4)}_${attrHex.slice(4, 8)}_${codeHex.slice(0, 4)}_${codeHex.slice(4, 8)}`;
}

/** Modul-Slug aus oberen 8 Bit von attr. Fallback 'unknown'. */
export function getHmsModule(attr: number): HmsModule {
  const moduleId = (attr >>> 24) & 0xff;
  return HMS_MODULE_BY_ID[moduleId] ?? 'unknown';
}

/** Severity aus oberen 16 Bit von code (Bambu-Konvention). Fallback 'common'. */
export function getHmsSeverity(code: number): HmsSeverity {
  const severityHex = ((code >>> 16) & 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return HMS_SEVERITY_BY_HEX[severityHex] ?? 'common';
}

/** Direkt-Link auf den Bambu-Troubleshooting-Eintrag. */
export function buildHmsWikiUrl(formattedCode: string): string {
  return `https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/${formattedCode}`;
}

/** Description aus Datenbasis. Default 'de' mit Fallback 'en'. */
export function getHmsDescription(
  formattedCode: string,
  preferLang: 'en' | 'de' = 'de',
): string | undefined {
  if (preferLang === 'de') {
    return HMS_DESCRIPTIONS_DE[formattedCode] ?? HMS_DESCRIPTIONS_EN[formattedCode];
  }
  return HMS_DESCRIPTIONS_EN[formattedCode] ?? HMS_DESCRIPTIONS_DE[formattedCode];
}

/** Vollständige Anreicherung. */
export function enrichHmsEntry(
  entry: { attr: number; code: number },
  preferLang: 'en' | 'de' = 'de',
): EnrichedHmsEntry {
  const formattedCode = formatHmsCode(entry.attr, entry.code);
  return {
    attr: entry.attr,
    code: entry.code,
    formattedCode,
    module: getHmsModule(entry.attr),
    severityLevel: getHmsSeverity(entry.code),
    description: getHmsDescription(formattedCode, preferLang),
    wikiUrl: buildHmsWikiUrl(formattedCode),
  };
}

/** Array-Mapper. */
export function mapHmsArray(
  hms: Array<{ attr: number; code: number }> | undefined,
  preferLang: 'en' | 'de' = 'de',
): EnrichedHmsEntry[] {
  if (!Array.isArray(hms)) return [];
  return hms.map((e) => enrichHmsEntry(e, preferLang));
}
