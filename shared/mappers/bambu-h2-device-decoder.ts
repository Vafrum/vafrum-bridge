/**
 * Bambu H2-Familie Multi-Extruder Temperatur-Decoder
 *
 * H2-Familie (H2D, H2D Pro, H2C, H2S) und X2D senden Temperaturen
 * in device.extruder.info[*].temp / device.bed.info.temp / device.ctc.info.temp
 * als gepackten 32-Bit-Integer:
 *
 *   Low Word (Bit 0-15, signed)  = aktuelle Temperatur
 *   High Word (Bit 16-31, signed) = Ziel-Temperatur
 *
 * Spec: docs/bridge/bambu-mqtt-function-map.md §1.3.6, §1.3.7, §1.3.8
 *
 * TS-Variante des Rust-Decoders apps/vafrum-bridge/src-tauri/src/lib.rs:decode_packed_temp.
 *
 * Im Gegensatz zum Rust-Original gibt diese TS-Variante IMMER ein Objekt zurück.
 * Der Caller entscheidet selbst ob "current = 0 && target = 0" als
 * "kein Sensor" oder "ausgeschaltet" interpretiert wird (siehe OBS-1 im Plan).
 */

export interface PackedTemperature {
  current: number;
  target: number;
  raw: number;
  /** true wenn Input null/undefined/ungültig war oder beide Werte 0 sind */
  isZero: boolean;
}

/**
 * Decodiert einen gepackten Temperatur-Integer in current/target.
 *
 * @param value — Bambu-Wert (Number, numerischer String, oder null/undefined)
 *
 * Zur Behandlung von "0 = kein Sensor vs. 0 = ausgeschaltet" siehe isZero-Flag.
 */
export function decodePackedTemp(
  value: number | string | null | undefined,
): PackedTemperature {
  const numeric = parseTempValue(value);

  if (numeric === null) {
    return { current: 0, target: 0, raw: 0, isZero: true };
  }

  // Low Word = untere 16 Bit, als signed-int interpretieren
  const lowUnsigned = numeric & 0xffff;
  const current = lowUnsigned >= 0x8000 ? lowUnsigned - 0x10000 : lowUnsigned;

  // High Word = obere 16 Bit, als signed-int interpretieren
  const highUnsigned = (numeric >> 16) & 0xffff;
  const target = highUnsigned >= 0x8000 ? highUnsigned - 0x10000 : highUnsigned;

  return {
    current,
    target,
    raw: numeric,
    isZero: current === 0 && target === 0,
  };
}

/**
 * Decodiert das gesamte device.extruder.info-Array eines Multi-Extruder-Druckers.
 * Jeder Eintrag liefert ein PackedTemperature-Objekt.
 *
 * @param extruderInfo — Array aus Bambu-Payload device.extruder.info[]
 */
export function decodeExtruderInfo(
  extruderInfo: unknown,
): PackedTemperature[] {
  if (!Array.isArray(extruderInfo)) return [];
  return extruderInfo.map((entry) => {
    if (entry && typeof entry === 'object' && 'temp' in entry) {
      return decodePackedTemp((entry as { temp: unknown }).temp as
        | number
        | string
        | null
        | undefined);
    }
    return decodePackedTemp(null);
  });
}

// ============================================================================
// AMS ↔ Düse-Zuordnung (H2D/H2C Snow-Encoding)
// ============================================================================

/**
 * Reference §3.6 + Z. 1066-1068: device.extruder.info[].snow encoded
 *   Low 4 Bits  = Tray-Index (0-3)
 *   Restliche Bits = AMS-Index
 *
 * Pro Extruder (Düse) gibt's einen snow-Wert der den verbundenen AMS+Tray angibt.
 * Damit ist die AMS↔Düse-Zuordnung deterministisch — KEINE Heuristik mehr nötig.
 */
export interface ExtruderAmsMapping {
  nozzleIdx: number;   // 0=links, 1=rechts (H2D/H2C)
  amsId: number;       // welcher AMS hängt an dieser Düse
  trayIdx: number;     // welcher Slot in dem AMS aktiv ist (0-3)
  rawSnow: number;
}

export function decodeExtruderSnow(extruderInfo: unknown): ExtruderAmsMapping[] {
  if (!Array.isArray(extruderInfo)) return [];
  const result: ExtruderAmsMapping[] = [];
  for (const entry of extruderInfo) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as { id?: unknown; snow?: unknown };
    const nozzleIdx = typeof e.id === 'number' ? e.id : (typeof e.id === 'string' ? parseInt(e.id, 10) : NaN);
    const snow = typeof e.snow === 'number' ? e.snow : (typeof e.snow === 'string' ? parseInt(e.snow, 10) : NaN);
    if (!Number.isFinite(nozzleIdx) || !Number.isFinite(snow)) continue;
    result.push({
      nozzleIdx,
      amsId: snow >> 4,
      trayIdx: snow & 0xF,
      rawSnow: snow,
    });
  }
  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function parseTempValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? Math.trunc(n) : null;
  }
  return null;
}
