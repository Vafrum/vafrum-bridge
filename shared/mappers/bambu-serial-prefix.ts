/**
 * Bambu Lab Seriennummer-Präfix-Tabelle und Modell-Detection
 *
 * Bambu-Seriennummern haben das Format <Modell-Präfix><Hardware-ID>.
 * Die Präfixe sind nicht offiziell dokumentiert — Werte stammen aus
 * Community-Reverse-Engineering und müssen pro Modell durch echte
 * Hardware-Traces verifiziert werden.
 *
 * Bei Unsicherheit Präfix mit TODO markieren, NICHT raten.
 *
 * Spec: docs/bridge/bambu-mqtt-function-map.md §8.2
 * Decision: basic-memory decisions/bambu-mqtt-architektur-entscheidungen-2026-05-03 (K7, K15)
 */

export type BambuModel =
  | 'X1'
  | 'X1C'
  | 'X1E'
  | 'P1P'
  | 'P1S'
  | 'P2S'
  | 'A1'
  | 'A1 mini'
  | 'H2D'
  | 'H2D Pro'
  | 'H2C'
  | 'H2S'
  | 'X2D'
  | 'unknown';

export type BambuModelClass = 'safe' | 'experimental' | 'unknown' | 'blocked';
export type BambuModelFamily = 'X1' | 'P1' | 'P2' | 'A1' | 'H2' | 'X2' | 'unknown';

export interface BambuModelInfo {
  model: BambuModel;
  family: BambuModelFamily;
  class: BambuModelClass;
}

/**
 * Bambu-Seriennummer-Präfixe → Modell-Mapping.
 *
 * Eintrag mit `verified: false` bedeutet: aus Community-Quellen,
 * noch nicht durch Hardware-Trace im Vafrum-Setup bestätigt.
 *
 * Reihenfolge ist wichtig: längere Präfixe MÜSSEN vor kürzeren stehen
 * damit z.B. "01S00" nicht versehentlich von "01" gematcht wird.
 */
interface PrefixEntry {
  prefix: string;
  model: BambuModel;
  verified: boolean;
  source?: string;
}

const PREFIX_TABLE: PrefixEntry[] = [
  // X1-Familie
  { prefix: '01S', model: 'X1C', verified: false, source: 'community' },
  { prefix: '00W', model: 'X1', verified: false, source: 'community' },
  { prefix: '03W', model: 'X1E', verified: false, source: 'community' },

  // P1-Familie
  { prefix: '00M', model: 'P1P', verified: false, source: 'community' },
  { prefix: '01P', model: 'P1S', verified: false, source: 'community' },

  // P2-Familie (TODO: Präfix verifizieren)
  // { prefix: '???', model: 'P2S', verified: false, source: 'TODO' },

  // A1-Familie
  { prefix: '039', model: 'A1 mini', verified: false, source: 'community' },
  { prefix: '094', model: 'A1', verified: false, source: 'community' },

  // H2-Familie (Hardware-verifiziert 2026-05-05 via Vafrum-Setup)
  { prefix: '0948', model: 'H2D', verified: true, source: 'real-hardware-2026-05-05' },
  { prefix: '31B8', model: 'H2C', verified: true, source: 'real-hardware-2026-05-05' },
  // { prefix: '???', model: 'H2D Pro', verified: false, source: 'TODO' },
  // { prefix: '???', model: 'H2S', verified: false, source: 'TODO' },

  // X2-Familie (K1: Hardware nicht verfügbar)
  // { prefix: '???', model: 'X2D', verified: false, source: 'TODO' },
];

/**
 * Modell-Klassen-Mapping.
 * Quelle: Function Map §8.2
 */
const MODEL_CLASS: Record<BambuModel, BambuModelClass> = {
  'X1': 'safe',
  'X1C': 'safe',
  'X1E': 'safe',
  'P1P': 'safe',
  'P1S': 'safe',
  'P2S': 'safe',
  'A1': 'safe',
  'A1 mini': 'safe',
  'H2D': 'experimental',
  'H2D Pro': 'experimental',
  'H2C': 'experimental',
  'H2S': 'experimental',
  'X2D': 'experimental',
  'unknown': 'unknown',
};

const MODEL_FAMILY: Record<BambuModel, BambuModelFamily> = {
  'X1': 'X1',
  'X1C': 'X1',
  'X1E': 'X1',
  'P1P': 'P1',
  'P1S': 'P1',
  'P2S': 'P2',
  'A1': 'A1',
  'A1 mini': 'A1',
  'H2D': 'H2',
  'H2D Pro': 'H2',
  'H2C': 'H2',
  'H2S': 'H2',
  'X2D': 'X2',
  'unknown': 'unknown',
};

/**
 * Erkennt Modell anhand Seriennummer-Präfix.
 * Tabelle ist nach Präfix-Länge absteigend sortiert für eindeutige Matches.
 */
export function detectModelBySerial(serial: string): BambuModelInfo {
  const normalized = serial.trim().toUpperCase();

  const sorted = [...PREFIX_TABLE].sort(
    (a, b) => b.prefix.length - a.prefix.length,
  );

  for (const entry of sorted) {
    if (normalized.startsWith(entry.prefix.toUpperCase())) {
      return {
        model: entry.model,
        family: MODEL_FAMILY[entry.model],
        class: MODEL_CLASS[entry.model],
      };
    }
  }

  return {
    model: 'unknown',
    family: 'unknown',
    class: 'unknown',
  };
}

/**
 * Liefert Liste aller in der Tabelle verifizierten Präfixe.
 * Nützlich für Debug/Diagnostik.
 */
export function getVerifiedPrefixes(): PrefixEntry[] {
  return PREFIX_TABLE.filter((e) => e.verified);
}

/**
 * Liefert Liste aller noch unverifizierten Präfixe (community-stamm).
 * Diese müssen durch Hardware-Trace bestätigt werden.
 */
export function getUnverifiedPrefixes(): PrefixEntry[] {
  return PREFIX_TABLE.filter((e) => !e.verified);
}

/**
 * Liefert Liste aller Modelle, deren Präfix als TODO markiert ist
 * (also gar keinen Eintrag in PREFIX_TABLE haben). Nützlich für
 * Status-Reports.
 */
export function getModelsWithoutPrefix(): BambuModel[] {
  const allModels: BambuModel[] = [
    'X1', 'X1C', 'X1E',
    'P1P', 'P1S',
    'P2S',
    'A1', 'A1 mini',
    'H2D', 'H2D Pro', 'H2C', 'H2S',
    'X2D',
  ];
  const known = new Set(PREFIX_TABLE.map((e) => e.model));
  return allModels.filter((m) => !known.has(m));
}

/**
 * Prüft ob ein Modell zur H2-Familie gehört (H2D, H2D Pro, H2C, H2S).
 * Diese Modelle teilen Multi-Extruder-Verhalten, Dual-Nozzle-Temperatur-Decoding,
 * vir_slot[]-Arrays, chamber_light2 + heatbed_light Konfiguration etc.
 */
export function isH2Family(model: BambuModel): boolean {
  return MODEL_FAMILY[model] === 'H2';
}

/**
 * Prüft ob ein Modell zur X2-Familie gehört (X2D).
 * Aktuell nur X2D, Hardware nicht verfügbar (K1).
 */
export function isX2Family(model: BambuModel): boolean {
  return MODEL_FAMILY[model] === 'X2';
}

/**
 * Prüft ob ein Modell Multi-Extruder-Hardware hat.
 * Aktuell: H2-Familie und X2-Familie.
 * Diese Drucker schicken Temperaturen gepackt in device.extruder.info[]
 * statt einzeln in nozzle_temper / nozzle_target_temper.
 */
export function isMultiExtruder(model: BambuModel): boolean {
  return isH2Family(model) || isX2Family(model);
}

/**
 * Liefert die Modell-Klasse für eine Familie als Übersicht.
 * Nützlich z.B. für UI-Badges.
 */
export function getFamilyClass(family: BambuModelFamily): BambuModelClass {
  switch (family) {
    case 'X1':
    case 'P1':
    case 'P2':
    case 'A1':
      return 'safe';
    case 'H2':
    case 'X2':
      return 'experimental';
    case 'unknown':
      return 'unknown';
  }
}
