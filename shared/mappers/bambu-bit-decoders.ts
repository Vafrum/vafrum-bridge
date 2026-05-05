/**
 * Bambu MQTT Bit-Decoder
 *
 * Bambu kodiert mehrere Status-Flags als 32-Bit-Integer.
 * Diese Helper extrahieren einzelne Bits in benannte Booleans.
 *
 * Hinweis: Bit-Layouts stammen aus Spec docs/bridge/bambu-mqtt-function-map.md §1.7, §1.9
 * und der externen Reference. Nicht alle Bits sind dokumentiert — bei Unsicherheit
 * werden nur die bestätigten Bits exportiert.
 *
 * Spec-Refs:
 * - home_flag: §1.9.8 (Door 0x00800000, Filament-Tangle 0x00100000, SD-Status, AMS-Auto-Switch)
 * - ams_exist_bits / tray_exist_bits: §1.7.4, §1.7.5
 * - tray_is_bbl_bits / tray_read_done_bits: §1.7.6, §1.7.7
 *
 * Zugehöriger Test: bambu-bit-decoders.test.ts
 */

// ============================================================================
// home_flag (Bambu Hardware-Status-Bitfeld)
// ============================================================================

const HOME_FLAG_DOOR_OPEN = 0x00800000;
const HOME_FLAG_FILAMENT_TANGLE = 0x00100000;
// Weitere Bits (SD-Card-Status, AMS-Auto-Switch) sind in der Spec erwähnt
// aber nicht dokumentiert mit konkretem Bit-Offset → bleiben TODO bis Trace.

export interface HomeFlagFlags {
  doorOpen: boolean;
  filamentTangle: boolean;
  raw: number;
}

/**
 * Decodiert home_flag-Integer in einzelne Status-Flags.
 *
 * @param value — der rohe home_flag-Integer aus dem MQTT-Payload, typisch decimal oder hex.
 *   Akzeptiert auch null/undefined → liefert dann alle Flags = false.
 */
export function decodeHomeFlag(value: number | string | null | undefined): HomeFlagFlags {
  const numeric = parseFlagValue(value);
  return {
    doorOpen: (numeric & HOME_FLAG_DOOR_OPEN) !== 0,
    filamentTangle: (numeric & HOME_FLAG_FILAMENT_TANGLE) !== 0,
    raw: numeric,
  };
}

// ============================================================================
// AMS-Bits (welche AMS-Units / Trays existieren / sind RFID-bereit)
// ============================================================================

/**
 * Extrahiert eine Liste von Bit-Positionen die in einem Integer gesetzt sind.
 * Beispiel: 0b1011 → [0, 1, 3]
 *
 * Wird verwendet für:
 * - ams_exist_bits → welche AMS-Unit-IDs sind angeschlossen
 * - tray_exist_bits → welche Tray-Slots haben Spulen drin
 * - tray_is_bbl_bits → welche Trays haben Bambu-Original-Spulen (RFID)
 * - tray_read_done_bits → welche Trays sind RFID-Lesung abgeschlossen
 *
 * @param value — Integer-Bitmaske
 * @param maxBits — Maximale Anzahl zu prüfender Bits (Default 32 für 32-Bit-Integer)
 */
export function decodeBitPositions(
  value: number | string | null | undefined,
  maxBits = 32,
): number[] {
  const numeric = parseFlagValue(value);
  const positions: number[] = [];
  for (let i = 0; i < maxBits; i++) {
    if ((numeric & (1 << i)) !== 0) {
      positions.push(i);
    }
  }
  return positions;
}

// ============================================================================
// Helpers
// ============================================================================

function parseFlagValue(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return 0;
    // Hex-String mit oder ohne 0x-Präfix
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      return parseInt(trimmed, 16);
    }
    if (/^[0-9a-fA-F]+$/.test(trimmed) && /[a-fA-F]/.test(trimmed)) {
      return parseInt(trimmed, 16);
    }
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}
