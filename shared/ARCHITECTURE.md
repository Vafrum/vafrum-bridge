# Vafrum – Systemarchitektur

> Zentrale Dokumentation für alle Agenten. Beschreibt Systemaufbau, Datenflüsse, Auth-Konzept, Schnittstellen und Wettbewerber-Analyse.

---

## Systemübersicht

| Komponente | Port | Framework | Beschreibung |
|---|---|---|---|
| `vafrum-core-api` | 4000 | NestJS 10.3 | REST API + WebSocket Gateway |
| `vafrum-core-web` | 4001 | Next.js 14 | Dashboard & Admin Panel |
| `vafrum-bridge-desktop` | – | Electron 28 | MQTT-Bridge + Kamera-Streaming (Windows) |
| `vafrum-mqtt-client` | – | Node.js/TS | Alternative Bridge ohne GUI |
| `Vafrum-Startseite` | 3002 | Vite/Tailwind | Corporate Website |
| PostgreSQL (Supabase) | – | Prisma ORM | Cloud-Datenbank |

---

## Datenfluss-Diagramm

```
  ┌──────────┐       HTTP/REST        ┌──────────────┐      Prisma       ┌────────────┐
  │ Browser  │ ◄───────────────────► │ vafrum-core  │ ◄──────────────► │ PostgreSQL │
  │ (Web)    │   JWT Auth             │    -api      │                   │ (Supabase) │
  │ :4001    │ ◄───────────────────► │   :4000      │                   └────────────┘
  └──────────┘    Socket.IO           └──────┬───────┘
                  (token: JWT)               │
                                             │ Socket.IO
                                             │ (auth: apiKey)
                                             │
                                    ┌────────▼────────┐
                                    │ vafrum-bridge    │
                                    │   -desktop       │
                                    │ (Electron)       │
                                    └────────┬─────────┘
                                             │
                                             │ MQTT over TLS
                                             │ Port 8883
                                             │ User: bblp
                                             │ Pass: {accessCode}
                                             │
                              ┌──────────────▼──────────────┐
                              │     Bambu Lab Drucker        │
                              │  (A1, P1S, X1C, H2D, ...)   │
                              └─────────────────────────────┘
```

**Kurzform:**
```
Browser → Web (:4001) → API (:4000) → DB (Supabase)
                             ↕ WebSocket
                         Bridge (Electron)
                             ↕ MQTT (TLS :8883)
                         Drucker (Bambu Lab)
```

---

## API-Authentifizierung

### JWT (Web-Clients)

| Aspekt | Detail |
|---|---|
| **Login** | `POST /api/auth/login` → `{ accessToken, refreshToken }` |
| **Header** | `Authorization: Bearer {accessToken}` |
| **Refresh** | `POST /api/auth/refresh` mit refreshToken |
| **Guards** | `JwtAuthGuard` (global), `RolesGuard` für Admin |
| **Decorators** | `@Public()`, `@CurrentUser()`, `@Roles('admin')` |

### API-Key (Bridge / MQTT-Clients)

| Aspekt | Detail |
|---|---|
| **Format** | `vfk_...` (Prefix `vfk_`) |
| **Erstellen** | `POST /api/api-keys` (authentifiziert) |
| **Verwendung** | WebSocket `auth: { apiKey: 'vfk_...' }` |
| **Scope** | Bridge-Kommunikation, Drucker-Status-Updates |

---

## Wichtige API-Endpoints

### Auth (`/api/auth`)
```
POST /register          Registrierung
POST /login             Login → JWT + Refresh Token
POST /refresh           Token erneuern
POST /logout            Ausloggen
DELETE /account          Account löschen
```

### Printers (`/api/printers`)
```
GET    /                Alle Drucker des Users
GET    /:id             Einzelner Drucker
GET    /:id/live        Live-Status (cached)
POST   /                Drucker erstellen
POST   /bulk            Bulk-Import (Business)
PATCH  /:id             Drucker bearbeiten
DELETE /:id             Drucker löschen
POST   /:id/command     Befehl an Drucker senden
```

### Filaments (`/api/filaments`)
```
GET    /                Alle Filamente
POST   /                Filament erstellen
PATCH  /:id             Filament bearbeiten
DELETE /:id             Filament löschen
```

### Spools (`/api/spools`)
```
GET    /                Alle Spulen
GET    /search          Katalog durchsuchen
POST   /                Spule aus Katalog hinzufügen
PATCH  /:id/status      Status aktualisieren
DELETE /:id             Spule löschen
```

### AMS (`/api/ams`)
```
GET    /                Alle AMS-Systeme
POST   /                AMS erstellen
PATCH  /:id/slots/:slot Slot zuweisen
```

### Prints (`/api/prints`)
```
GET    /                Druck-Historie
GET    /statistics      Statistiken
POST   /                Druck erfassen
DELETE /:id             Druck löschen
```

### Admin (`/api/admin/...`)
```
GET    /users                      Alle User
PATCH  /users/:id/role             Rolle ändern
GET    /filament-catalog/catalog   Vollständiger Katalog
POST   /filament-catalog/brands    Marke erstellen
```

---

## WebSocket Events (Socket.IO)

### Von Bridge empfangen (API-Key Auth)

| Event | Payload | Beschreibung |
|---|---|---|
| `printer:status` | `PrinterStatus` | Status-Update eines Druckers |
| `printer:status:batch` | `PrinterStatus[]` | Batch-Update |
| `printers:request` | – | Druckerliste anfordern |
| `printer:command:result` | `{ serial, success, error? }` | Befehlsergebnis |

### An Web-Clients senden (JWT Auth)

| Event | Payload | Beschreibung |
|---|---|---|
| `authenticated` | `{ userId }` | Auth erfolgreich |
| `printer:status` | `PrinterStatus` | Live-Status-Broadcast |
| `printers:list` | `Printer[]` | Druckerliste |
| `printer:add` | `Printer` | Neuer Drucker |
| `printer:remove` | `{ id }` | Drucker entfernt |

---

## Unterstützte Drucker-Modelle

> Vollständige Klassifizierung, Begründung und Command-Freigaben siehe
> `docs/bridge/bambu-mqtt-function-map.md` §8 (Modellmatrix), §9
> (Developer-Mode), §10 (Pushall-Diskrepanz) und §11 (HMS-Linking).
> Diese Tabelle ist die Kurzfassung – im Konfliktfall gilt die
> Function Map.

### Klassen-Definition (Kurzform)

| Klasse | Bedeutung | Umsetzung |
|---|---|---|
| **safe** | Format verifiziert, Real-Traces, Mapper produktiv | Telemetry + sichere Steuerbefehle freigeschaltet |
| **experimental** | Format teilweise bekannt, Felder unstabil | Read-only parsen, Steuerbefehle nur hinter Beta-Flag |
| **unknown** | Keine verifizierten MQTT-Traces im Repo | **Nicht implementieren** – kein Adapter, keine UI |
| **blocked** | Explizit gesperrt | Verbindung verweigern |

### Modell-Matrix (vollständig)

| Modell | Klasse | Kamera | Dual-Nozzle | AMS-Typ | Notes |
|---|---|---|---|---|---|
| **A1** | safe | TCP/JPEG :6000 | Nein | Lite | Single-Nozzle, Delta-Updates. Max 2–3 LAN-Clients. |
| **A1 mini** | safe | TCP/JPEG :6000 | Nein | Lite | wie A1, kleiner Bauraum. |
| **P1P** | safe | – | Nein | Standard (extern) | **Nur 1 LAN-Client**, `pushall` ≥ 5 min. |
| **P1S** | safe | TCP/JPEG :6000 | Nein | Standard | mehrere LAN-Clients erlaubt. |
| **P2S** | safe | RTSPS :322 | Nein | Standard | Eigenes TLS-Cert. Airduct-Befehl modellspezifisch. |
| **X1** | safe | RTSPS :322 | Nein | Standard | Komplette Status-Frames. |
| **X1C** | safe | RTSPS :322 | Nein | Standard | wie X1 + LIDAR. |
| **X1E** | safe | RTSPS :322 | Nein | AMS-HT | Enterprise-Variante (`hw_ver=AP02`). |
| **X2D** | experimental | RTSPS :322 (anzunehmen) | **Ja** | AMS 2 Pro | Dual-Nozzle, gleicher H2-JSON-Schema-Pfad. **Mapper nicht aktiviert** ohne Real-Trace. |
| **H2S** | experimental | RTSPS :322 | **Ja** | AMS 2 Pro | gleiche H2-Familie. |
| **H2D** | experimental | RTSPS :322 | **Ja** (`nozzleTemp2` vorbereitet) | AMS 2 Pro | Neues `device.*`-JSON-Format, `vir_slot[].id` 254/253. |
| **H2D Pro** | experimental | RTSPS :322 | **Ja** | AMS 2 Pro | + Enterprise-Netzwerkfelder (VLAN/Proxy/Client-Cert) → diese Felder gelten als **unknown**. |
| **H2C** | unknown | – | – | – | **Keine Traces im Repo. Nicht implementieren.** |
| **„Vortek"** | unknown | – | – | – | Codename ohne öffentliches Schema. **Nicht implementieren.** |

### Regeln je Klasse (Kurzform)

- **Single-Nozzle A/P/X1-Familie (A1, A1 mini, P1P, P1S, P2S, X1, X1C, X1E):**
  produktiv parsebar, Telemetrie + safe-Commands freigeschaltet (siehe
  Function Map §8.3).
- **H2D / H2D Pro / H2S / X2D (Dual-Nozzle):** experimentell.
  Telemetrie-Schema ist im Code vorbereitet (`PrinterStatus.nozzleTemp2`,
  `externalSpools[]`), aber der Bambu-Mapper aktiviert die Dual-Nozzle-
  Felder noch **nicht**. Steuerbefehle nur Beta-Flag.
- **H2D Pro Enterprise-Netzwerkfelder** (VLAN-Tags, Proxy-Konfiguration,
  X.509-Client-Cert-Slots): **unknown** – nicht parsen, nicht setzen.
- **H2C / „Vortek":** unknown. **Ohne echte MQTT-Traces nicht
  implementieren** (keine Adapter, keine UI-Affordance, keine Commands).

### Developer-Mode-Regeln (Kurzform)

| Pfad | Vorausgesetzt | Vafrum |
|---|---|---|
| LAN read | Access Code | ✅ erlaubt, auch ohne Developer Mode |
| LAN write | Developer Mode aktiv am Drucker | 🚫 ohne Developer Mode blockiert |
| Cloud read | Bambu Account + JWT | ✅ |
| Cloud write | Bambu Authorization Control | ⚠ erlaubt, mit Audit |
| **Cloud parallel zu Developer Mode** | – | ❌ **nicht** als unterstützt annehmen |

Details und Hybrid-Mode-Block (P1 ≥ 01.07) siehe Function Map §9.

---

## Wettbewerber-Analyse: Spooly (spooly.eu)

> Detaillierte Analyse basierend auf: `C:\Users\Administrator\spooly-analysis\full-exploration\`

### Übersicht

| Aspekt | Detail |
|---|---|
| **Domain** | spooly.eu |
| **Standort** | Österreich (Innsbruck) |
| **Gründung** | 2024 |
| **Version** | 3.1.0 |
| **Plattformen** | Web, iOS, Android, PWA |

### Spooly Abo-Modelle

| Plan | Preis | Details |
|---|---|---|
| Free Trial | 0 € | 7 Tage, alle Pro-Features |
| Pro Monatlich | 2,99 €/Monat | Volles Feature-Set |
| Pro Jährlich | 28,70 €/Jahr | 20% Ersparnis |
| Pro Lifetime | 99,99 € einmalig | Lebenslanger Zugang |

### Spooly Features

- Unbegrenztes Filament-Tracking
- Bambu Lab Cloud Auto-Sync (X1C, P1S, P1P, A1)
- KI-Foto-Import für Filamente
- QR-Code Labels für Spulen
- Multi-Color Filament Support
- Verbrauchsstatistiken
- Lagerort-Verwaltung
- Druckauftrags-Historie & Kostenberechnung
- Feuchtigkeits-Tracking
- Virtuelles AMS (manuell, NICHT synchronisiert)

### Schwächen von Spooly (Wettbewerbsvorteile für Vafrum)

#### 1. Passwort-Handling (Kritisch)
- **Kein eigenes Passwort-Management** sichtbar
- Vermutlich nur OAuth/Social Login (Apple/Google)
- **Keine Zwei-Faktor-Authentifizierung** (2FA)
- Keine Session-Verwaltung ("Alle Geräte abmelden")
- Nutzer ohne Apple/Google-Konto ausgeschlossen

#### 2. Kein Impressum (Rechtlich Kritisch)
- **Kein Impressum** vorhanden – Verstoß gegen österreichisches ECG
- Nur `addressCountry: "AT"` im Schema.org Markup
- Keine Firmenname, keine Adresse, keine Kontaktdaten
- Keine UID-Nummer, kein Firmenbuchgericht

#### 3. Keine AGB / Nutzungsbedingungen (Rechtlich Kritisch)
- **Keine AGB** auffindbar
- Keine Widerrufsbelehrung (EU-Pflicht bei digitalen Inhalten)
- Keine Kündigungsbedingungen
- Keine Info zur automatischen Abo-Verlängerung

#### 4. DSGVO-Bedenken
- Google Analytics + AdSense + Cloudflare Analytics eingebunden
- **Kein sichtbarer Cookie-Consent-Banner**
- Drittanbieter-Scripts von `emergent.sh` geladen

#### 5. Funktionale Schwächen
- **AMS synchronisiert NICHT automatisch** mit dem Drucker – trotz "Auto-Sync"-Versprechen
- **Nur Bambu Lab** als Integration – kein OctoPrint, kein Klipper
- **Keine offene API** für Drittanbieter
- **Werbung (AdSense) trotz Bezahl-Abo**
- **Cloud-only** – kein Self-Hosting möglich
- Reines SPA ohne SSR – schlechte SEO

#### 6. Preisinkonsistenz
- Lifetime-Preis: 49,99 € (Noscript) vs. 99,99 € (Schema.org) – Widerspruch

### Vafrum-Vorteile gegenüber Spooly

| Bereich | Spooly | Vafrum |
|---|---|---|
| AMS-Sync | Manuell | Automatisch via Bridge |
| Drucker-Steuerung | Keine direkte Kontrolle | Vollständig (Pause, Temp, Lüfter, etc.) |
| Kamera | Keine | Live-Streaming (MJPEG/RTSP) |
| Dual-Nozzle | Nicht unterstützt | H2D/H2S/H2C Support |
| Auth | Nur Social Login | JWT + eigenes Login + API-Keys |
| Rechtliches | Kein Impressum, keine AGB | Vollständig (geplant) |
| Architektur | Cloud SPA | Hybrid (Cloud API + lokale Bridge) |
| Datenschutz | Tracking ohne Consent | DSGVO-konform (geplant) |

---

*Zuletzt aktualisiert: 2026-02-05*
