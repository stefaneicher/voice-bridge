# Voice-Bridge

Systemweite Push-to-Talk-Spracheingabe für Windows. Schweizerdeutsch rein, Hochdeutsch raus.

## Installation

Voraussetzung: [Node.js 22](https://nodejs.org/) oder neuer.

**Aus dem GitHub-Release (empfohlen, keine Anmeldung nötig):**

1. Auf der [Release-Seite](https://github.com/stefaneicher/voice-bridge/releases/latest) die Datei `stefaneicher-voice-bridge-<version>.tgz` herunterladen.
2. Installieren:

   ```bash
   npm install -g ./stefaneicher-voice-bridge-0.1.0.tgz
   ```

**Aus GitHub Packages** (braucht einmalig einen GitHub-Token mit `read:packages`):

```bash
npm config set @stefaneicher:registry https://npm.pkg.github.com
npm config set //npm.pkg.github.com/:_authToken <TOKEN>
npm install -g @stefaneicher/voice-bridge
```

Danach gibt es zwei Befehle: `voice-bridge` (die App) und `vb` (verbindet Agents).

**Ohne npm:** Im Release liegen auch `Voice-Bridge-<version>-setup.exe` und eine portable `.exe`. Für `vb run` braucht es trotzdem das npm-Paket.

Hinter einem Firmen-Proxy lädt npm Electron von GitHub. Falls das blockiert ist: `ELECTRON_MIRROR` auf einen internen Spiegel setzen.

## Benutzung

1. Starten: `voice-bridge` (oder `voice-bridge --background`). Im Tray erscheint ein Mikrofon.
2. Im Tray-Menü **Einstellungen → Spracherkennung** den OpenAI-API-Key eintragen. Unter **Allgemein** lässt sich «Beim Anmelden starten» einschalten.

**Diktat:** Maus 4 halten, sprechen, loslassen. Der Text erscheint am Cursor, ohne automatisches Absenden.

**Agent:** Maus 5 halten und sprechen. Beim Zeiger erscheint ein Popup mit den laufenden Agent-Sessions. Mit dem Mausrad oder per Klick die Session wählen. Beim Loslassen geht der Prompt an die markierte Session, ohne Fokuswechsel.

Damit eine Session in der Liste erscheint, den Agent über Voice-Bridge starten:

```bash
vb run -- copilot
```

Beide Tasten sind in den Einstellungen frei belegbar (auch Tastaturtasten). Für Citrix ein eigenes Profil nutzen: `voice-bridge --profile citrix` und `vb run --profile citrix -- copilot`.

Geht etwas schief (Session beendet, Transkription fehlgeschlagen), bleibt der Text bzw. die Aufnahme erhalten, bis du entscheidest: erneut versuchen, andere Session wählen, kopieren oder verwerfen.

## Ablauf

![Ablauf: Mikrofon → Voice-Bridge → Spracherkennung (OpenAI) → Text → Cursor oder Agent-Session](docs/ablauf.png)

Die Spracherkennung läuft über OpenAI. Claude bietet keine Sprach-API an, kann aber Ziel sein (`vb run -- claude`).

## Mockups

Alle Mockups im Browser: [Übersicht](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/index.html)

| Mockup | Inhalt |
|---|---|
| [1a](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/1a-diktat-aufnahme.html) | Diktat: Aufnahme läuft |
| [1b](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/1b-diktat-eingefuegt.html) | Diktat: Text eingefügt |
| [2a](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/2a-agent-session-popup.html) | Agent: Session-Popup |
| [2b](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/2b-agent-gesendet.html) | Agent: Prompt gesendet |
| [3a](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/3a-fehlerfaelle.html) | Fehlerfälle |
| [3b](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/3b-tray-menue.html) | Tray-Menü |
| [3c](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/3c-einstellungen.html) | Einstellungen |
| [4](https://raw.githack.com/stefaneicher/voice-bridge/main/docs/mockups/4-ablauf.html) | Ablauf: Mikrofon → KI → Ziel |

## Lokal testen (ohne Release)

```bash
git clone https://github.com/stefaneicher/voice-bridge.git
cd voice-bridge
git checkout claude/repo-access-61t4xd   # bis der Stand in main ist
npm install
npm run build
npm link        # stellt die Befehle voice-bridge und vb global bereit
voice-bridge    # App starten (Tray-Icon erscheint)
```

In einem zweiten Terminal: `vb run -- copilot`. Rückgängig machen mit `npm unlink -g @stefaneicher/voice-bridge`.

## Entwicklung und Release

```bash
npm run dev      # App mit Hot Reload
npm test         # Tests
npm run lint
```

Release: Version erhöhen und Tag pushen, den Rest macht GitHub Actions (Tests, Windows-Installer, npm-Paket, GitHub-Release, GitHub Packages; npmjs.com nur mit Secret `NPM_TOKEN`):

```bash
npm version patch
git push --follow-tags
```
