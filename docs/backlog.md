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
- Vergleich: `gpt-transcribe` (Datei) vs. `gpt-live-transcribe` (live), je mit und ohne Stufe 2 (Glättung). Die gpt-4o-Modelle und `whisper-1` entfallen am 26.2.2027 (ADR-019).
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

### ☑ T-023 Copilot-Titel für verbundene Terminals (ADR-015)
- `vb run` meldet die PID seines Kindprozesses (`register`/`heartbeat`).
- Leser für `~/.copilot/session-state` (nur lesend, eigener Adapter); Zuordnung über `inuse.<PID>.lock`.
- **Fertig, wenn** das Popup «Write Message Function» statt «copilot» zeigt, mit Ordner; ohne Session-Ordner oder bei unbekanntem Format bleibt es beim heutigen Namen. Unit-Tests mit Beispieldateien.

### ☐ T-024 Ruhende Copilot-Sessions per Resume starten (ADR-015)
- Popup listet zusätzlich Sessions ohne Lock (Standard: letzte 7 Tage, einstellbar), sortiert: verbundene zuerst, dann nach `updated_at`.
- Loslassen öffnet `wt new-tab -d <cwd> vb run --session <id> -- copilot --resume=<id>`; Ziel ist die Session-ID.
- Zustellung erst, wenn sich ein Terminal mit genau dieser Session-ID anmeldet. Overlay «Starte ‹Titel› …».
- **Fertig, wenn** der Text in der neu geöffneten Session ankommt; nach 20 s ohne Anmeldung Fehler-Dialog mit «Kopieren», keine Umleitung. Integrationstest mit Fake-Starter.

### ☐ T-025 Fremd belegte Sessions anzeigen (ADR-015)
- Lock mit einer PID, die keinem `vb run` gehört: grau, «anderswo offen», nicht wählbar (Mausrad überspringt sie).
- **Fertig, wenn** eine in IntelliJ offene Session sichtbar, aber nicht wählbar ist.

### ☑ T-026 Neue Session per Stimme (ADR-017)
- Das Popup hat am Ende eine Zeile «＋ Neue Session · in ‹Ordner›». Ordner ist der `cwd` der gewählten, sonst der zuletzt verwendeten Session. Ohne bekannten `cwd` oder ohne Terminal-Starter ist die Zeile ausgeblendet.
- Wählbar mit Mausrad und Klick wie jede Session; gewählt trägt sie das «Ziel»-Badge.
- Loslassen (nach erfolgreicher Transkription): zufälliges Token (8 Hex-Zeichen), dann `wt new-tab -d <ordner> vb run --profile <p> --launch <token> -- copilot`; ohne `wt` über `cmd /c start`. Argumente als Array, kein Shell-String mit dem Ordner.
- `vb run --launch <token>` meldet das Token bei der Anmeldung. Zugestellt wird nur an die Session mit genau diesem Token, und erst wenn Copilot das Eingabefeld zeigt. Die Frage «Do you trust the files in this folder?» wird nie mit dem Prompt beantwortet.
- Overlay während des Wartens: «Starte Session in ‹Ordner› …».
- Pro Token genau ein Start; ein weiteres Loslassen während des Starts wird ignoriert.
- **Fertig, wenn** der Text in der neuen Session ankommt; nach 20 s ohne bereite Session Fehler-Dialog «Neue Session nicht bereit» mit Hinweis «Im Terminal bestätigen», «Nochmals» (wartet weiter auf dasselbe Token, startet kein zweites Terminal) und «Kopieren». Keine Umleitung. Unit-Tests für Core, Starter, Bereitschaftserkennung und Popup-Zeile.

### ◐ T-027 Hauptfenster «Agent Desk» (ADR-018)
- **Umgesetzt:** Stufen 1–3 (Gerüst mit Einklapp-Variante «Schiene», Sessions, Composer mit Verlauf und Diktat-Umleitung); Unit-Tests für die Logik in `src/core`. **Offen:** Test der Oberfläche von Hand, Konsolen-Spiegel.
- **Stufe 1 · Gerüst:** Fenstertitel «Agent Desk», links Werkzeugleiste (44 px) und Sessions, Mitte Composer, rechts Inspektor. Linke und rechte Spalte klappen zu einer 28 px breiten Schiene mit senkrechtem Titel ein; ein Klick auf die Schiene klappt auf. Der Zustand bleibt nach einem Neustart erhalten (pro Profil, `desk.*` in der Konfiguration).
- Die bestehenden Einstellungen sind im Inspektor erreichbar (Reiter «Einstellungen», Werkzeug ⚙, Tray «Einstellungen …», zweiter Start). Es gibt nur einen Konfigurationsspeicher; ein Schnellschalter im Inspektor ist sofort auch in den Einstellungen sichtbar. Kein separates Einstellungsfenster mehr.
- Startet mit dem Fenster, ausser «Beim Start im Tray bleiben» ist gesetzt. ✕ schliesst nur das Fenster.
- **Stufe 2 · Sessions:** Liste aller Sessions mit Name, Ordner und Status «bereit», «beschäftigt», «getrennt». Die fixierte Session ist markiert. Klick fixiert per ID; das Popup zeigt danach dieselbe Session vorgewählt. Fehlt die fixierte Session, bleibt sie als «getrennt» sichtbar und es wird nichts umgestellt.
- «＋ Neue Session» startet über den Starter aus T-026 ein Terminal im Ordner der fixierten (sonst ersten) Session und fixiert die neue Session, sobald sie sich mit dem Token meldet (ausser der Nutzer hat inzwischen selbst ein anderes Ziel gewählt). Ohne bekannten Ordner (oder über «…») wird zuerst ein Ordner gewählt. Ohne Starter ist die Aktion ausgeblendet.
- **Stufe 3 · Composer:** Textfeld in der Mitte, Strg+Enter sendet an die fixierte Session über den normalen Zustellweg. Erfolgreich gesendete Prompts erscheinen im Verlauf (nur Arbeitsspeicher); Pfeil hoch/runter blättert im leeren Feld. Bei einem Fehler bleibt der Text im Feld und die Meldung nennt den Grund.
- Hat der Agent Desk den Fokus und ist der Composer aktiv, landet ein Diktat im Composer statt am Cursor.
- **Nicht Teil davon:** Konsolen-Spiegel (später, nur lesend, eigener ADR).
- **Fertig, wenn** Unit-Tests für Status-Abbildung, Fixieren, Starten, Senden, Verlauf und Diktat-Umleitung grün sind und `src/core` ≥ 90 % Abdeckung hat.

---

## Idee · Handy als Mikrofon

### ☐ T-030 Mikrofon-Auswahl in den Einstellungen
- Liste der Audio-Eingänge (Recorder-Fenster, `enumerateDevices`), Auswahl pro Profil in `audio.deviceId`.
- Damit funktionieren Handy-Mikrofon-Apps (z. B. WO Mic), die unter Windows als Mikrofon erscheinen.

### ◐ T-031 Handy als Push-to-Talk-Mikrofon (Android-App, ADR-013, Mockup 5)
- **Umgesetzt:** Server mit TLS-Pinning und Kopplung (PC), Android-App mit QR-Scan, Ziel-Auswahl, Halten-Knopf, Rückmeldung; Unit-, Integrations- und App-Tests. **Offen:** Test auf einem echten Handy, im Firmennetz und unter Citrix.
- Voice-Bridge startet pro Profil einen HTTPS-Server im lokalen Netz und zeigt einen QR-Code (URL + Einmal-Token).
- Handy-Browser: grosser Halten-Knopf, Session-Auswahl, Ziel «Am Cursor». Audio geht per WebSocket an den PC, ab dort gleicher Ablauf wie mit der Maustaste.
- HTTPS ist Pflicht, weil Handy-Browser das Mikrofon sonst nicht freigeben: eigenes Zertifikat, einmalige Warnung auf dem Handy.
- Risiken: Firmen-Firewall und Citrix blockieren eingehende Verbindungen wahrscheinlich. Vor dem Bau Spike: privat und im Firmennetz testen.
- Vor der Umsetzung ADR schreiben (Netzwerk, Pairing, Sicherheit).

## Phase 4 · M3–M6

- **M3** Einstellungen (Mockup 3c), Profile, safeStorage, Verlauf, Hotkey-Erfassung («Taste drücken …»).
- **M4** Citrix-Testlauf nach [`citrix.md`](citrix.md).
- **M5** AcpAdapter (`copilot --acp --stdio`, TS-SDK).
- **M6** macOS (CGEventTap), Linux X11, lokale Engine.
