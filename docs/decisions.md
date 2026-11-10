# Entscheidungen (ADR-Log)

Kurzform: Kontext → Entscheid → Folgen. Neue Einträge unten anhängen, alte nicht umschreiben, sondern mit einem neuen Eintrag ablösen.

---

## ADR-001 · Electron + TypeScript statt Tauri/Rust

**Status:** angenommen (10.11.2026)

**Kontext:** Die App muss privat und im Firmen-Citrix laufen. In der Firma ist npm installierbar, eine Rust- oder C++-Toolchain vermutlich nicht. Gebraucht werden transparente Overlays, globale Hooks und ein PTY. Für Copilot CLI (ACP) gibt es ein offizielles TS-SDK. OpenWhispr zeigt, dass Electron für Diktat-Overlays funktioniert.

**Entscheid:** Electron (aktuelle LTS-Linie), TypeScript strict, Svelte 5, electron-vite, Vitest, npm.

**Folgen:**
- Grössere Pakete und mehr RAM als bei Tauri.
- Native Funktionen nur über Prebuild-Pakete (koffi, node-pty, uiohook-napi) oder Helper, die in CI gebaut werden.
- Die Kernlogik bleibt UI- und Electron-frei in `src/core/`, damit ein späterer Shell-Wechsel möglich bleibt.

---

## ADR-002 · Svelte 5 statt Angular für die Overlays

**Status:** angenommen (10.11.2026)

**Kontext:** Vier kleine Overlay-Fenster plus ein Einstellungsfenster. electron-vite unterstützt Svelte direkt, Angular nicht.

**Entscheid:** Svelte 5 (Runes).

**Folgen:** Wenig Boilerplate und schneller Start. Wer aus Angular kommt, braucht etwas Einarbeitung.

---

## ADR-003 · Hooks unterdrücken über Win32 (koffi), nicht über uiohook

**Status:** vorgeschlagen, wird in Spike S1 geprüft

**Kontext:** Maus 4/5 lösen sonst im Browser «Zurück/Vor» aus. Das Mausrad scrollt während der Agent-Aufnahme das Fenster darunter. uiohook kann Events nur beobachten, nicht verschlucken.

**Entscheid:** Unter Windows `SetWindowsHookExW(WH_MOUSE_LL / WH_KEYBOARD_LL)` über koffi im Main-Prozess. Konfigurierte Tasten und das Mausrad während der Agent-Aufnahme geben `1` zurück.

**Fallback:** Ein kleiner nativer Helper (`vb-hook.exe`, C), in GitHub Actions gebaut und über stdio angebunden.

**Folgen:** Der Hook-Callback muss in unter 1 ms zurückkehren (Windows entfernt langsame Hooks still). Darum keine Logik im Callback, nur Event in eine Queue.

---

## ADR-004 · Agent-Anbindung über PTY-Wrapper (`vb run`) als erster Adapter

**Status:** angenommen (10.11.2026)

**Kontext:** Copilot CLI bietet einen ACP-Server (`copilot --acp`, Public Preview). Ein ACP-Client kann aber nicht an eine laufende interaktive TUI-Session andocken. Tastatursimulation mit Fokuswechsel ist durch die Anforderungen ausgeschlossen.

**Entscheid:**
- **PtyBridgeAdapter:** `vb run -- <befehl>` startet den Agenten in einer Pseudo-Konsole, reicht I/O durch und registriert sich per Named Pipe / Unix-Socket. Voice-Bridge schreibt Prompts direkt in den Eingang der PTY.
- **AcpAdapter** folgt als zweiter Adapter (M5).
- **Firstmate:** bis zur Klärung kein Adapter, nur das Interface.

**Folgen:**
- Der Nutzer muss Agents über `vb run` starten (Alias empfohlen).
- Sessions ausserhalb von `vb run` sind unsichtbar. Das ist gewollt: lieber sichtbar fehlen als falsch zugestellt.

---

## ADR-005 · STT zweistufig konfigurierbar

**Status:** vorgeschlagen, wird in Spike S4 geprüft

**Kontext:** Die OpenAI-API hat kein Sprachkürzel für Schweizerdeutsch. Ausgabe soll lesbares Hochdeutsch sein, Rohtranskript optional.

**Entscheid:** Stufe 1 transkribiert (`gpt-4o-transcribe`, `language=de`, Prompt mit Glossar). Stufe 2 glättet optional (Chat-Modell, Schweizer Hochdeutsch, ss statt ß, Inhalt unverändert). Beide Stufen und Modelle sind konfigurierbar.

**Folgen:** Mehr Latenz und Kosten, wenn Stufe 2 aktiv ist. Messung in S4 entscheidet den Default.

---

## ADR-006 · Profile als getrennte Instanzen

**Status:** angenommen (10.11.2026)

**Entscheid:** `--profile <name>` legt fest: Konfigurationsordner (`%APPDATA%/voice-bridge/<profil>/`), safeStorage-Schlüssel, Pipe-Name `voice-bridge-<profil>` und Single-Instance-Lock. Kein Profilwechsel im laufenden Betrieb.

**Folgen:** Privat und Citrix bleiben vollständig getrennt. Zwei Instanzen auf einem Rechner sind möglich.

---

## ADR-007 · Audio über Web Audio im versteckten Renderer

**Status:** angenommen (10.11.2026), löst O-2

**Kontext:** Für die Aufnahme braucht es entweder ein natives Modul (`naudiodon`) oder Web Audio im Renderer. Ein natives Audio-Modul bringt wieder Compiler- oder Prebuild-Risiken.

**Entscheid:** Ein verstecktes Recorder-Fenster nimmt mit `getUserMedia` auf (ScriptProcessor, kein Worklet-Modul unter der strikten CSP), rechnet auf 16 kHz mono herunter und schickt beim Loslassen einmal ein WAV per IPC. Nur dieses Fenster darf das Mikrofon nutzen. «Mikrofon offen halten» (Standard an) ist in den Einstellungen abschaltbar.

**Folgen:** Kein natives Audio-Modul. Startlatenz mit offen gehaltenem Mikrofon klein; Messung unter Windows steht noch aus (T-010).

---

## ADR-008 · Pipe-Name enthält Benutzer und Profil

**Status:** angenommen (10.11.2026), ergänzt ADR-006

**Kontext:** Windows-Named-Pipes sind maschinenweit sichtbar. Auf einem Citrix-Server teilen sich viele Benutzer denselben Namensraum.

**Entscheid:** `\\.\pipe\voice-bridge-<benutzer>-<profil>` (Unix: Socket in `$XDG_RUNTIME_DIR` bzw. tmp). Eine Session-ID kann nur von der Verbindung genutzt werden, die sie registriert hat.

**Folgen:** Zwei Benutzer auf demselben Server stören sich nicht. Die Standard-DACL von Windows verhindert Schreibzugriff anderer Benutzer.

---

## ADR-009 · Verteilung als npm-Paket plus Windows-Installer

**Status:** angenommen (10.11.2026)

**Kontext:** In der Firma ist npm verfügbar. Der Name `voice-bridge` ist auf npmjs.com vergeben.

**Entscheid:**
- Paketname `@stefaneicher/voice-bridge` mit den Befehlen `voice-bridge` (startet die App über Electron) und `vb`.
- Im Repo ist Electron eine devDependency (verlangt electron-builder). Der Release-Workflow macht Electron vor `npm pack` zur Laufzeit-Abhängigkeit.
- Ein Tag `v*` baut: `.tgz` (npm), NSIS-Installer und portable `.exe`, hängt alles an ein GitHub-Release und veröffentlicht in GitHub Packages. npmjs.com nur, wenn das Secret `NPM_TOKEN` gesetzt ist.

**Folgen:** Installation mit `npm install -g <tgz>` ohne Compiler unter Windows (node-pty, koffi und uiohook-napi haben Prebuilds). Electron wird beim Installieren von GitHub geladen; hinter einem Proxy ggf. `ELECTRON_MIRROR` setzen.

---

## ADR-010 · Natives Tray-Menü statt eigenem Flyout (MVP)

**Status:** angenommen (10.11.2026)

**Kontext:** Mockup 3b zeigt ein gestaltetes Flyout. Ein natives Menü ist schneller umgesetzt, barrierefrei und verhält sich überall erwartbar.

**Entscheid:** Für den MVP ein natives Kontextmenü mit denselben Inhalten (Status, Profil, Modell, Tasten, Verlauf, Pausieren, Einstellungen, Beenden). Das Flyout bleibt im Backlog.

---

## ADR-011 · Electron 45: asynchrone Zwischenablage

**Status:** angenommen (10.11.2026)

**Kontext:** Ab Electron 45 ist `clipboard` asynchron und arbeitet mit `ClipboardItem` (wie die Web-API).

**Entscheid:** `ClipboardPort` ist asynchron. Der Snapshot liest alle Formate sofort aus, damit er nach dem Einfügen zurückgeschrieben werden kann.

---

## ADR-012 · Quality Gates und Release-Ablauf

**Status:** angenommen (10.11.2026)

**Kontext:** Bisher prüfte die CI Lint, Typen, Tests und Build. Ein falsch formatierter Commit und ein macOS-Fehler zeigten, dass Prüfungen früher und breiter greifen sollen.

**Entscheid:**
- Lokal: husky mit lint-staged (ESLint, Prettier auf geänderten Dateien) und commitlint.
- Commits nach Conventional Commits (Angular-Stil). release-please erzeugt daraus Release-PR, Version, Changelog und Tag und ruft den Release-Workflow direkt auf (Tags des Standard-Tokens starten keine Workflows).
- CI: Abdeckungs-Gate `src/core` ≥ 90 % (Zeilen, Zweige, Funktionen, Anweisungen), knip, actionlint, Electron-Starttest mit Playwright, npm-Paket-Test, CodeQL, Dependabot, `npm audit` im Release.
- AI-Review über GitHub Copilot Code Review (Repo-Einstellung), nur beratend, kein Merge-Blocker.
- Bewusst nicht: externe Dienste wie SonarCloud, Pinnen der Actions auf SHAs (vorerst).

**Folgen:** Branch-Schutz für `main` mit den CI-Jobs als Pflichtprüfungen ist eine Repo-Einstellung und wird von Hand gesetzt.

---

## Offen

| # | Frage | Wer/Wann |
|---|---|---|
| O-1 | Was ist Firstmate, hat es eine Schnittstelle? | Stefan |
| O-2 | ~~Audio: Web Audio oder natives Modul?~~ Entschieden in ADR-007 | – |
| O-3 | PTY-Senden: mit Enter (Default) oder als Entwurf? Umgesetzt als Einstellung, Default Enter | M2 |
| O-4 | Lizenz / Sichtbarkeit des Repos | Stefan |
| O-5 | Konfiguration zwischen Profilen exportierbar? | M3 |
