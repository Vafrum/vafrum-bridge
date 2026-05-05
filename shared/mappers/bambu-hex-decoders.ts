/**
 * Bambu MQTT Hex-Decoder
 *
 * Zwei Bambu-Felder werden als Hex-Strings übertragen:
 * - stat: Türsensor-Bitmaske bei H2/P2-Modellen (Bit-Layout aktuell undokumentiert)
 * - fun: 32-Bit-Status u.a. mit Developer-Mode-Indikator
 *
 * Beide Decoder geben den raw-Wert zurück + die aktuell sicher dokumentierten Flags.
 * Weitere Flags werden ergänzt sobald Hardware-Traces verfügbar (Plan K12, K13).
 *
 * Spec-Refs:
 * - stat: Function Map §1.9.10 + Reference §3.4
 * - fun: Function Map §1.9.11 + Reference §3.4
 */

// ============================================================================
// fun (32-bit Hex, enthält u.a. Developer-Mode)
// ============================================================================

// Beobachtung aus Reference §3.4:
// "3EC1AFFF" und "3EC18FFF" unterscheiden sich an Bit 0x00002000 (Bit 13).
// Polarität (welcher Wert = Dev-Mode an) ist noch nicht final bestätigt
// → wir geben sowohl raw als auch das gesetzte Bit zurück.
const FUN_DEVELOPER_MODE_BIT = 0x00002000;

export interface FunFlags {
  developerModeBitSet: boolean;
  raw: number;
  rawHex: string;
}

/**
 * Decodiert das fun-Feld.
 *
 * @param value — Hex-String (mit oder ohne 0x-Präfix), Number, oder null/undefined.
 *   null/undefined/leerer-String/ungültig → alles false, raw=0.
 *
 * Hinweis: Polarität des Developer-Mode-Bits ist nicht final geklärt (K13).
 * Caller muss aus Hardware-Beobachtung selbst entscheiden ob 1 = aktiv oder 0 = aktiv.
 */
export function decodeFun(value: number | string | null | undefined): FunFlags {
  const numeric = parseHexValue(value);
  return {
    developerModeBitSet: (numeric & FUN_DEVELOPER_MODE_BIT) !== 0,
    raw: numeric,
    rawHex: numeric === 0 ? '0' : numeric.toString(16).toUpperCase(),
  };
}

// ============================================================================
// stat (Türsensor-Hex bei H2/P2)
// ============================================================================

export interface StatFlags {
  raw: number;
  rawHex: string;
  // Bit-Layout K12 offen → keine benannten Flags bis Hardware-Trace
}

/**
 * Decodiert das stat-Feld.
 *
 * Aktuell wird nur der raw-Wert zurückgegeben, da das Bit-Layout
 * noch nicht dokumentiert ist (K12).
 *
 * Sobald Hardware-Traces verfügbar sind, werden hier benannte
 * Flags wie doorClosed, doorLocked etc. ergänzt.
 */
export function decodeStat(value: number | string | null | undefined): StatFlags {
  const numeric = parseHexValue(value);
  return {
    raw: numeric,
    rawHex: numeric === 0 ? '0' : numeric.toString(16).toUpperCase(),
  };
}

// ============================================================================
// Helpers
// ============================================================================

function parseHexValue(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      return parseInt(trimmed, 16);
    }
    if (/^[0-9a-fA-F]+$/.test(trimmed)) {
      return parseInt(trimmed, 16);
    }
    return 0;
  }
  return 0;
}
