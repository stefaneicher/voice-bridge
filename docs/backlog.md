# Backlog

Reihenfolge = Priorität. Jede Aufgabe hat Abnahmekriterien. Ein Spike endet mit einem kurzen Ergebnis-Eintrag in [`decisions.md`](decisions.md) und wird danach weggeworfen oder ins Projekt übernommen.

Legende: ☐ offen · ◐ in Arbeit · ☑ erledigt

**Stand 10.11.2026:** Code für M1 und M2 ist umgesetzt und unter Linux getestet (Unit- und PTY-Integrationstests, App-Start). ◐ heisst: umgesetzt, aber noch nicht auf einem echten Windows-Rechner abgenommen. Offen sind die Messungen und Abnahmen, die Hardware brauchen: S0 (Firmen-npm), S1/S2 (Hook und Fokus unter Windows), S4 (STT-Vergleich mit eigenen Aufnahmen), T-010 (Startlatenz), T-012 (Einfügen in Notepad, Outlook, Browser), M4 (Citrix). Das Tray-Flyout aus Mockup 3b ist vorerst ein natives Menü (ADR-010).

---

## Phase 0 · Grundgerüst

### ☑ T-001 Projekt aufsetzen
- electron-vite mit Svelte-5-Template, TypeScript `strict`, ESLint + Prettier, Vitest.
- Ordner gemäss [`PLAN.md`](PLAN.md#8-repo-struktur-ziel), leere `index.ts` je Modul.
- `npm run dev`, `npm test`, `npm run build` funktionieren.
- GitHub Actions: `npm ci && npm test` auf `windows-latest`, `ubuntu-latest`, `macos-latest`.

**Fertig, wenn** ein leeres Tray-Icon unter Windows erscheint und die CI grün ist.

### ☑ T-002 Core-Typen und State Machine (ohne I/O)
- `src/core/`: Typen `HotkeyBinding`, `SessionInfo`, `DeliveryResult`, `Failure`, State Machine gemäss PLAN §2.
- Ports als Interfaces: `InputPort`, `RecorderPort`, `SpeechToText`, `AgentAdapter`, `TextInserter`, `Clock`.
- Fakes in `test/fakes/`.
- Die sechs Pflichttests aus PLAN §7 als Vitest-Tests, alle grün.

**Fertig, wenn** `npm test` die sechs Szenarien abdeckt und `src/core` keinen Import aus `electron` oder `node:` hat (per ESLint-Regel erzwungen).

---

## Phase 1 · Spikes (Risiken zuerst)

### ☐ S0 npm im Firmennetz
- Auf dem Firmenrechner: `npm install koffi node-pty uiohook-napi electron` in einem leeren Ordner.
- Notieren: Prebuilds geladen? Proxy-Probleme? Build-Tools verlangt?

**Ergebnis:** Ja/Nein pro Paket in `decisions.md`.

### ◐ S1 Globaler Hook mit Unterdrückung (Windows)
- `WH_MOUSE_LL` über koffi im Electron-Main-Prozess.
- XButton1/2 down/up loggen **und verschlucken**: Der Browser darf nicht zurückblättern.
- Zusätzlich das Mausrad verschlucken, solange XButton2 gehalten ist.
- Latenz des Callbacks messen (unter 1 ms).

**Fertig, wenn** ein Demo-Log Down/Up/Wheel zeigt und Chrome nicht navigiert.

### ◐ S2 Overlay ohne Fokusdiebstahl
- Transparentes, rahmenloses Fenster, `focusable:false`, `showInactive()`, `alwaysOnTop:'screen-saver'`.
- In Notepad tippen, Overlay ein- und ausblenden: Der Cursor bleibt, Tippen geht weiter.
- Popup-Variante: Klick auf eine Zeile wird erkannt, Notepad behält den Fokus (sonst `WS_EX_NOACTIVATE` per koffi setzen).

**Fertig, wenn** beide Varianten nachweislich den Fokus nicht stehlen.

### ◐ S3 PTY-Wrapper
- `vb run -- copilot` (zum Testen auch `-- node test/echo-agent.js`) mit node-pty.
- Ein Test-Client schreibt per Named Pipe Text in die Session, während ein anderes Fenster aktiv ist.
- Multi-line per Bracketed Paste (`ESC[200~ … ESC[201~`), danach `\r`.

**Fertig, wenn** der Text in Copilot CLI ankommt und abgeschickt wird, ohne Fensterwechsel.

### ☐ S4 STT Berndeutsch
- 20 eigene Aufnahmen (5–20 s, Alltag und Fachbegriffe).
- Vergleich: `gpt-4o-transcribe` vs. `gpt-4o-mini-transcribe` vs. `whisper-1`, je mit und ohne Stufe 2 (Glättung).
- Messen: Latenz (p50/p95), subjektive Qualität 1–5, Kosten.

**Ergebnis:** Tabelle und Default-Wahl in `decisions.md` (ADR-005).

---

## Phase 2 · M1 Diktat (Windows)

### ◐ T-010 Audio-Recorder
- Mikrofon vorwärmen, Start unter 50 ms nach Tastendruck.
- 16 kHz mono PCM, WAV im RAM, Pegel-Events 30×/s.
- Kein Schreiben auf Disk.

### ☑ T-011 OpenAiTranscriber
- `POST /v1/audio/transcriptions`, Timeout 15 s, Abbruch möglich.
- Glossar aus den Einstellungen als `prompt`.
- Optional Stufe 2.
- Fehler als `Failure{kind:'stt'}` mit Audio-Referenz.

### ◐ T-012 TextInserter (Windows)
- Zwischenablage sichern, Text setzen, `SendInput` Ctrl+V, nach 300 ms wiederherstellen.
- Kein Enter.
- Kein fokussiertes Textfeld (wo erkennbar): Text in der Zwischenablage lassen und Fehler «Kein Textfeld» melden.

### ☑ T-013 Pill und Toast (Svelte)
- Gemäss Mockups 1a/1b und [`ui-spec.md`](ui-spec.md).
- Zustände per IPC vom Main-Prozess.

### ◐ T-014 Tray
- Icon-Zustände, Menü gemäss Mockup 3b (Profil anzeigen, Pausieren, Einstellungen, Beenden, Verlauf).

**M1 fertig, wenn** Diktat in Notepad, Outlook und Browser funktioniert, inklusive Fehlerfälle.

---

## Phase 3 · M2 Agent

### ☑ T-020 Session-Registry und PtyBridgeAdapter
- Named-Pipe-Server pro Profil.
- Protokoll NDJSON: `register`, `heartbeat`, `bye` vom Wrapper; `inject` von Voice-Bridge.
- Session weg bei `bye`, geschlossener Pipe oder Heartbeat über 5 s.

### ☑ T-021 Session-Popup
- Gemäss Mockup 2a: Mausrad über den Hook (nicht über DOM-Events, da kein Fokus), Klick über das Fenster.
- Auswahl per ID, Live-Update der Liste.

### ☑ T-022 Zustellung und Fehlerfälle
- Toast 2b.
- Dialoge 3a für Session weg, Senden fehlgeschlagen, keine Sessions.

**M2 fertig, wenn** fünf parallele `vb run -- copilot`-Sessions per Mausrad und per Klick erreichbar sind und eine während der Aufnahme beendete Session korrekt als Fehler endet.

---

## Phase 4 · M3–M6

- **M3** Einstellungen (Mockup 3c), Profile, safeStorage, Verlauf, Hotkey-Erfassung («Taste drücken …»).
- **M4** Citrix-Testlauf nach [`citrix.md`](citrix.md).
- **M5** AcpAdapter (`copilot --acp --stdio`, TS-SDK).
- **M6** macOS (CGEventTap), Linux X11, lokale Engine.
