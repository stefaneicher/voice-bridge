# Entscheidungen (ADR-Log)

Kurzform: Kontext → Entscheid → Folgen. Neue Einträge unten anhängen, alte nicht umschreiben, sondern mit einem neuen Eintrag ablösen.

---

## ADR-001 · Electron + TypeScript statt Tauri/Rust

**Status:** angenommen (10.11.2026)

**Kontext:** Die App muss privat und im Firmennetz laufen. In der Firma ist npm installierbar, eine Rust- oder C++-Toolchain vermutlich nicht. Gebraucht werden transparente Overlays, globale Hooks und ein PTY. Für Copilot CLI (ACP) gibt es ein offizielles TS-SDK. OpenWhispr zeigt, dass Electron für Diktat-Overlays funktioniert.

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

**Nachtrag:** Stufe 2 ist standardmässig aus. Im Alltag formulierte sie Eingaben zu oft um und kostete pro Diktat spürbar Zeit; der Rohtext von Stufe 1 ist bereits Hochdeutsch.

---

## ADR-006 · Profile als getrennte Instanzen

**Status:** angenommen (10.11.2026)

**Entscheid:** `--profile <name>` legt fest: Konfigurationsordner (`%APPDATA%/voice-bridge/<profil>/`), safeStorage-Schlüssel, Pipe-Name `voice-bridge-<profil>` und Single-Instance-Lock. Kein Profilwechsel im laufenden Betrieb.

**Folgen:** Profile bleiben vollständig getrennt. Zwei Instanzen auf einem Rechner sind möglich.

---

## ADR-007 · Audio über Web Audio im versteckten Renderer

**Status:** angenommen (10.11.2026), löst O-2

**Kontext:** Für die Aufnahme braucht es entweder ein natives Modul (`naudiodon`) oder Web Audio im Renderer. Ein natives Audio-Modul bringt wieder Compiler- oder Prebuild-Risiken.

**Entscheid:** Ein verstecktes Recorder-Fenster nimmt mit `getUserMedia` auf (ScriptProcessor, kein Worklet-Modul unter der strikten CSP), rechnet auf 16 kHz mono herunter und schickt beim Loslassen einmal ein WAV per IPC. Nur dieses Fenster darf das Mikrofon nutzen. «Mikrofon offen halten» (Standard an) ist in den Einstellungen abschaltbar.

**Folgen:** Kein natives Audio-Modul. Startlatenz mit offen gehaltenem Mikrofon klein; Messung unter Windows steht noch aus (T-010).

---

## ADR-008 · Pipe-Name enthält Benutzer und Profil

**Status:** angenommen (10.11.2026), ergänzt ADR-006

**Kontext:** Windows-Named-Pipes sind maschinenweit sichtbar. Auf einem gemeinsam genutzten Server teilen sich viele Benutzer denselben Namensraum.

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

## ADR-013 · Handy als Mikrofon über eine Android-App

**Status:** angenommen (10.11.2026), ersetzt das Browser-Konzept aus T-031

**Kontext:** Das Handy soll als Mikrofon dienen. Eine Seite im Handy-Browser bräuchte HTTPS, und ein selbst signiertes Zertifikat erzeugt dort eine Warnung, die man jedem Nutzer erklären muss. Eine native App kann das Zertifikat dagegen selbst prüfen.

**Entscheid:**
- **Android-App** in Kotlin mit Jetpack Compose (`android/`), gebaut mit Gradle, in CI getestet und im Release als APK angehängt. Keine iOS-App vorerst.
- **Verbindung:** WebSocket über TLS im lokalen Netz (`wss://<ip>:47613/vb`). Voice-Bridge erzeugt pro Profil ein selbst signiertes Zertifikat (5 Jahre). Der QR-Code enthält Adressen, Port, den SHA-256-Fingerabdruck des Zertifikats und einen Einmal-Code. Die App vertraut nur genau diesem Zertifikat (Pinning), ohne CA und ohne Hostnamen-Prüfung.
- **Kopplung:** Einmal-Code (10 Minuten, 5 Fehlversuche), danach Geräte-Token. Der PC speichert nur Hashes der Tokens; Geräte lassen sich in den Einstellungen entfernen.
- **Ablauf:** Ein Druck auf dem Handy wird zu einem Hotkey-Ereignis mit vorgewähltem Ziel; die Audiodaten (16 kHz PCM16) ersetzen für diese Aufnahme das PC-Mikrofon. Der Kern bleibt unverändert, bis auf das vorgewählte Ziel: ein ausdrücklich gewähltes Ziel wird nie durch eine andere Session ersetzt.
- **Standard: aus.** Der Server läuft nur, wenn «Verbindungen vom Handy erlauben» eingeschaltet ist.

**Folgen:**
- Windows fragt beim ersten Start nach der Firewall. Im Firmennetz blockiert die Firewall eingehende Verbindungen wahrscheinlich.
- Release-APKs brauchen für Updates denselben Schlüssel: Secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Ohne sie wird mit einem Debug-Schlüssel signiert.
- Zum Bauen braucht es das Android-SDK (CI hat es; lokal Android Studio oder die Kommandozeilen-Tools).

---

## ADR-014 · Gestaltung im Stil von stefaneicher.github.io

**Status:** angenommen (10.11.2026), löst die Farben der ursprünglichen Mockups ab

**Entscheid:** Desktop-App, Android-App, Webseite und Grafiken nutzen die Palette der persönlichen Webseite (Disroop): Hintergrund `#15151C`, Teal `#2AA5A1` für Diktat, Lime `#A3D858` für Agent, Blau `#245E71`, Schriften Inter und JetBrains Mono. Das Einstellungsfenster ist jetzt dunkel. Werte in `docs/ui-spec.md`.

**Folgen:** Die Mockups sind umgefärbt; ihre Abläufe gelten unverändert.

---

## ADR-015 · Copilot-Sessions im Popup über die Session-Dateien von Copilot

**Status:** angenommen (10.11.2026)

**Kontext:** Das Popup zeigt nur laufende `vb run`-Terminals, alle heissen «copilot». Der Nutzer denkt aber in den Sessions, die Copilot CLI im Tab «Sessions» bzw. bei `/resume` zeigt (Titel, Ordner, «In use»). Copilot CLI 1.0.109 hat dafür keinen dokumentierten Listen-Befehl (`copilot sessions` kennt nur `import`). Dokumentiert sind nur `--resume=<id|name>` und `--session-id`.

**Entscheid:**
- Voice-Bridge **liest** `~/.copilot/session-state/*/workspace.yaml` (`id`, `name`, `cwd`, `updated_at`) und `inuse.<PID>.lock`. Es **schreibt nie** dort hinein.
- `vb run` meldet die PID seines Kindprozesses. Passt sie zu einem `inuse.<PID>.lock`, ist die Session **verbunden** und trägt deren Titel.
- Session ohne Lock = **ruhend**. Wählen und Loslassen öffnet ein neues Terminal (`wt new-tab -d <cwd> vb run --session <id> -- copilot --resume=<id>`). Der Text wird erst zugestellt, wenn sich genau dieses Terminal mit dieser Session-ID anmeldet; sonst nach 20 s Fehler mit erhaltenem Text.
- Lock mit fremder PID = **fremd belegt**: sichtbar, grau, nicht wählbar. Kein Zugang ohne Tastatursimulation, und Copilot sperrt die Session.
- Fehlt der Ordner oder ist das Format unbekannt, fällt das Popup ohne Fehler auf die heutigen `vb run`-Terminals zurück.

**Folgen:**
- Abhängigkeit von einem undokumentierten Format. Der Leser ist isoliert (eigener Adapter, Tests mit Beispieldateien) und toleriert fehlende Felder.
- Ruhende Sessions starten einige Sekunden; das Overlay zeigt «Starte ‹Titel› …».
- Windows Terminal (`wt`) wird für ruhende Sessions vorausgesetzt; fehlt es, ist die Zeile nicht wählbar.
- Umsetzung: T-023 bis T-025.

---

## ADR-017 · Neue Copilot-Session per Stimme, an ein Start-Token gebunden

**Status:** angenommen (T-026)

**Kontext:** Der Nutzer will einen Prompt an eine Copilot-Session schicken, die es noch nicht gibt, meist im Ordner der Session, mit der er gerade arbeitet. Voice-Bridge darf den Text nie an «irgendein neues Terminal» oder eine andere Session umleiten. Copilot CLI fragt in einem neuen Ordner «Do you trust the files in this folder?»; Enter beantwortet die Frage mit «Yes». Ein zu früh eingefügter Prompt würde sie also beantworten. (ADR-016 ist für die Live-Transkription vergeben.)

**Entscheid:**
- Das Popup bekommt eine virtuelle Zeile «＋ Neue Session» (`vb:new-session`) für den Ordner der gewählten bzw. zuletzt verwendeten Session. Die Logik (Zeile, wartender Start, Zeitlimit, Fehler mit Text) liegt in `src/core` hinter dem Port `SessionLauncher` (`available()`, `launch(folder, token)`); Zeitlimit über `Clock`.
- Gestartet wird erst nach erfolgreicher, nicht leerer Transkription. Pro Loslassen ein zufälliges Token (8 Hex-Zeichen); ein zweites Loslassen während des Starts wird ignoriert.
- Start: `wt new-tab -d <ordner> <vb> run --profile <p> --launch <token> -- copilot`. Fehlt `wt`, dann `cmd /d /c start "" "<vb>" … ` mit dem Ordner als Arbeitsverzeichnis. Der Ordner geht nie in einen Shell-String; enthält er `;` (Trennzeichen von `wt`), wird `-d .` mit Arbeitsverzeichnis verwendet. Pfade mit `"%&|<>^` werden für `cmd` abgelehnt.
- `<vb>` ist `vb.cmd`/`vb.exe` aus `PATH`, sonst `node bin/vb.js` des Checkouts (nicht aus einem asar-Archiv). Das Profil wird immer mitgegeben, damit die neue Session an derselben Pipe landet. Nur Windows; sonst ist die Zeile ausgeblendet.
- `vb run --launch <token>` sendet das Token und einen Startzustand in `register`. Bis Copilot bereit ist, meldet die Session `busy`. Bereit heisst: der Platzhalter des Eingabefelds («… ? for shortcuts») ist zu sehen und keine Vertrauensfrage («Confirm folder trust» / «Do you trust the files in this folder?») offen. Eine offene Frage wird nur durch eine Taste des Nutzers im Terminal beendet. Erkannt wird auf dem Ausgabe-Ende ohne Escape-Sequenzen und Leerraum, damit Zeilenumbrüche und ConPTY-Neuzeichnen nicht stören.
- Zugestellt wird nur an die Session mit genau diesem Token im Zustand `idle`. Nach 20 s: Fehler `launch` mit erhaltenem Text, Hinweis «Im Terminal bestätigen», «Nochmals» wartet weiter auf dasselbe Token (kein zweites Terminal), «Kopieren». Scheitert schon der Start, startet «Nochmals» mit neuem Token.

**Folgen:**
- Abhängigkeit von den Texten der Copilot-Oberfläche (Platzhalter, Vertrauensfrage). Ändern sie sich, bleibt die Session `busy` und der Nutzer bekommt nach 20 s den Fehler mit Text, es geht nichts verloren.
- Restrisiko: Zeichnet Copilot das Eingabefeld vor der Vertrauensfrage, ohne die Frage danach auszugeben, gälte die Session zu früh als bereit. Beobachtet ist die umgekehrte Reihenfolge.
- Bestehende Sessions ohne Token verhalten sich wie bisher (Ruhe-Heuristik).
- Das Handy (ADR-013) sieht die virtuelle Zeile nicht.

---

## ADR-018 · Hauptfenster «Agent Desk»

**Status:** angenommen (T-027)

**Kontext:** Bisher hat Voice-Bridge neben den Overlays nur das Einstellungsfenster. Wer mit mehreren Copilot-Sessions arbeitet, will die Sessions, ihren Status und das aktuelle Ziel an einem Ort sehen, einen Prompt auch tippen und eine neue Session starten können. Das Konzept (lokal, `.lavish/main-window.html`) schlägt ein Hauptfenster im Stil von IntelliJ vor und bewertet die Risiken: Ein Spiegel der Konsole hat nur eine PTY-Grösse (hoch), braucht beim Einstieg mitten in der Session einen Schnappschuss (mittel), erlaubt doppelte Eingabe (mittel) und muss ruhende Sessions lesen (mittel). Diktat bei eigenem Fokus (tief) und doppelte Schalter (tief) sind lösbar.

**Entscheid:**
- Neues Hauptfenster mit Fenstertitel «Agent Desk». Das Produkt heisst weiter «Voice-Bridge» (Tray, Installer, Profile).
- Aufbau: links eine Werkzeugleiste (44 px) und die einklappbare Liste «Sessions», in der Mitte Composer und Prompt-Verlauf, rechts der einklappbare Inspektor mit Session-Details, Schnellschaltern und den Einstellungen.
- Einklappen nach Variante B «Schiene»: Die Spalte wird zu einer 28 px breiten Leiste mit senkrechtem Titel, ein Klick klappt sie wieder auf. Der Zustand gilt pro Profil und liegt in der Konfiguration (`desk.leftCollapsed`, `desk.rightCollapsed`).
- **Ein Konfigurationsspeicher:** Einstellungen und Schnellschalter im Inspektor lesen und schreiben dieselbe Konfiguration über denselben Store im Renderer. Das separate Einstellungsfenster entfällt; Tray «Einstellungen …» und ein zweiter Start öffnen den Agent Desk mit den Einstellungen im Inspektor. Abweichung vom Konzept: Dort ersetzen die Einstellungen hinter ⚙ die Mitte; hier liegen sie im rechten Bereich, damit Sessions und Composer sichtbar bleiben.
- Das Fenster öffnet beim Start, ausser «Beim Start im Tray bleiben» (`desk.startInTray`) ist gesetzt. ✕ schliesst nur das Fenster, Voice-Bridge läuft im Tray weiter.
- Die Sessions-Liste zeigt alle Sessions mit Name, Ordner und Status (bereit / beschäftigt / getrennt). Ein Klick fixiert die Session per ID als Ziel (dasselbe Ziel wie im Popup). Fehlt die fixierte Session, bleibt sie als «getrennt» stehen; es wird nie still auf eine andere umgestellt. «＋ Neue Session» nutzt den Starter aus ADR-017.
- Der Composer schickt Text über denselben Zustellweg wie der Agent-Hotkey, strikt an die gewählte Session-ID. Bei einem Fehler bleibt der Text im Feld. Gesendete Prompts stehen in einem Verlauf im Arbeitsspeicher (nur für diesen Lauf).
- **Diktat bei eigenem Fokus:** Hat der Agent Desk den Fokus und ist der Composer aktiv, geht ein Diktat in den Composer statt über die Zwischenablage an den Cursor (kleiner, getesteter `RoutedInserter`).
- **Konsolen-Spiegel zuletzt und nur lesend:** Die Mitte zeigt vorerst den Prompt-Verlauf. Ein Spiegel der Copilot-Konsole kommt als letzter Schritt, nur lesend, mit eigenem ADR (PTY-Grösse, Schnappschuss, ruhende Sessions).

**Folgen:**
- Das E2E-Startszenario rechnet mit dem Hauptfenster bzw. mit `desk.startInTray`.
- Das Overlay-Verhalten (Pill, Popup, Toast) bleibt unverändert; kein `focus()` auf Overlays.
- Weitere Schritte laut Konzept (T-024/T-025, Konsole) sind nicht Teil von T-027.

---

## ADR-019 · Citrix-Sonderthema gestrichen, Profile bleiben

**Status:** angenommen (11.11.2026), ändert Punkte in `requirements.md` und PLAN §6

**Kontext:** Das Profil `citrix` enthielt keine Citrix-spezifische Logik, es war nur ein Profilname. Ein Testprotokoll für Citrix (Hotkeys, HDX-Audio, Zwischenablage) wurde nie geführt.

**Entscheid:** `docs/citrix.md`, PLAN §6, Meilenstein M4 und der Citrix-Tab in den Einstellungen entfallen. Der Profil-Mechanismus (ADR-006, ADR-008) bleibt unverändert. Citrix wird nicht mehr als Ziel- oder Prüfumgebung geführt.

**Folgen:** `requirements.md` bleibt als ursprüngliche Vorgabe unverändert und nennt Citrix weiterhin. Das Tray-Menü kennt als zweites Profil weiter den Namen `citrix`. Beides ist nur historisch bzw. ein Profilname.

---

## ADR-020 · Live-STT mit mittlerer Verzögerung und sofortigem Aufnahmebeginn

**Status:** angenommen (13.11.2026)

**Kontext:** Bei schnellem Sprechen nach dem Hotkey konnte der Anfang fehlen: Der Recorder setzte den Aufnahmestatus erst nach `AudioContext.resume()`, obwohl der Mikrofon-Stream bereits offen sein konnte. Zudem war die Live-Verzögerung auf «low» gesetzt, obwohl höhere Stufen zugunsten der Erkennungsqualität spätere Vorschau-Texte liefern.

**Entscheid:**
- Der Recorder aktiviert die Aufnahme vor dem asynchronen Vorbereiten/Fortsetzen des Audio-Kontexts. Fehler setzen den Zustand zurück; es gibt keinen Vorlauf-Audiopuffer vor dem Tastendruck.
- Live-STT verwendet standardmässig `medium`. Die Stufe ist in den Einstellungen auswählbar; das separat konfigurierte Datei-Modell bleibt unverändert.
- Konfigurationen ohne Versionsfeld werden einmalig auf Version 1 migriert und auf «medium» gesetzt. Danach bleiben explizite Einstellungen erhalten.

**Folgen:** Die Live-Vorschau kann etwas später erscheinen als mit «low». Das behebt den Verlust des ersten Audioblocks, garantiert aber keine fehlerfreie Erkennung einzelner Wörter oder Laute.

---

## ADR-021 · Isoliertes Spracherkennungs-Testlabor mit Zustimmung je Aufnahme

**Status:** angenommen (13.11.2026), ergänzt ADR-007 und ADR-018

**Kontext:** Für die Verbesserung der Spracherkennung sollen reproduzierbare, vom Nutzer ausgewählte Sprachbeispiele vorliegen. Audio darf lokal gespeichert werden, aber nur nach ausdrücklicher Zustimmung; einzelne Testpakete können danach manuell zum Auswerten bereitgestellt werden. Der RAM-Standard aus PLAN und ADR-007 bleibt verbindlich.

**Entscheid:**
- Ein Werkzeug im Agent Desk ersetzt dessen Mitte durch einen kleinen Testmodus. Normale Diktat-/Agent-Aufnahmen und Handy-Eingaben sind pausiert; Composer-Senden, Session-Start und Wiederholungen alter Zustellfehler sind gesperrt. Kein Testpfad kennt einen Agent- oder Einfüge-Port. Beim Verlassen wird der vorige Pausezustand wiederhergestellt.
- Ein Testsatz, explizite Cloud-Bestätigung pro Versuch, Start/Stop-Schaltflächen und maximal 120 Sekunden Aufnahme bilden den ersten vertikalen Schnitt. Recorder und konfigurierte Live-/Datei-STT sowie optionale Nachbearbeitung werden wiederverwendet, aber mit eigener Lab-Pipeline ohne Diagnose-Logging. Kein zusätzlicher Dienst, keine Telemetrie, keine automatische Übertragung von Testpaketen.
- Die im Main-Prozess empfangene WAV-Aufnahme, erwarteter/finaler Text, Rohtext (falls vorhanden), monotone Vorschau-Schnappschüsse, separate Stop-/Final-Zeitpunkte, Ereignisse und ein erlaubnislistenbasierter STT-Konfigurationsausschnitt bleiben zunächst nur im RAM. Die Zeitbasis beginnt bei der Start-Anforderung und enthält die Mikrofon-Startzeit. Korrektheit wird manuell beurteilt, nicht automatisch für Mundart bewertet.
- Ausschliesslich «Audio + Messdaten lokal speichern» autorisiert die dauerhafte Speicherung genau der aktuellen Aufnahme; Cloud-Zustimmung ist ausdrücklich **keine** Speicherzustimmung. Ein neuer Versuch überschreibt kein ungespeichertes Ergebnis. Fehler erhalten vorhandene Daten im RAM; Schliessen des Desk verlangt zuerst das ausdrückliche Verwerfen/Schliessen der Auswahl und Verlassen des Labors.
- Pro Profil und Test eine atomar geschriebene JSON-Datei unter `speech-lab`, `schemaVersion: 1`, inklusive Base64-WAV (16 kHz, mono, PCM16). Maximal 100 gespeicherte Tests, keine automatische Bereinigung. Der Exportdialog schreibt einen ausgewählten gespeicherten Test als gleiches portables JSON-Paket; keine neue Abhängigkeit/ZIP-Bibliothek. IDs, Grössen, Typen und WAV-Kopf werden beim Laden geprüft; unbekannte oder beschädigte Dateien werden ohne Änderung mit Hinweis übersprungen.
- Gespeicherte Aufnahmen können geladen, manuell bewertet und vollständig gelöscht werden. Beim Löschen des geöffneten Tests verschwindet auch dessen RAM-Kopie. Exporte sind unabhängige Kopien. Keine API-Keys, Endpoint-URLs, Session-Ziele oder sonstige Konfiguration im Paket.

**Folgen:** Bewusste Ausnahme vom RAM-Standard nur für ausgewählte Lab-Aufnahmen. Pakete enthalten sensible Stimme und Texte; Weitergabe bleibt eine manuelle Nutzeraktion. Base64 benötigt etwa 33 % mehr Platz. Kein Audio-Player, Import, automatisches Scoring, Batch-Replay oder Modellvergleich im MVP. Normales Diktat bleibt unverändert.

---

## ADR-022 · Eigenständiges Android-Diktat

**Status:** Android-Diktat-MVP implementiert; Geräteabnahme auf A54 offen (20.11.2026)

**Kontext:** Die bestehende Android-App ist ein PC-Mikrofon-Client: `MainViewModel`
startet die Aufnahme nur bei einer PC-Verbindung und übermittelt Audio mit
`BridgeClient`. Das neue Diktat soll unabhängig auf dem Handy laufen, direkt
OpenAI verwenden und den Text nur in das sicher identifizierte ursprüngliche
Feld einfügen. Der Zielentwurf sieht ein Overlay über der vorhandenen Tastatur
und eine Aktivierung per Hardwaretaste vor.

**Spike-Ergebnis:** Siehe
[`spikes/android-dictation/README.md`](../spikes/android-dictation/README.md).
Das Galaxy A54 (`SM-A546B`, Android 16 / API 36, gemeldete One-UI-Kennung
`80500`) ist per ADB erreichbar; Samsung Keyboard ist aktiv. Ein isolierter
Debug-Proof-of-Concept prüft Overlay, Lautstärke-Key-down/up über einen
Bedienungshilfen-Dienst, Einfügen über ein eigenes IME sowie nun den
Android-13+-Schreibkanal `InputMethod.AccessibilityInputConnection` des
Bedienungshilfen-Dienstes. Der neue Pfad liest keine Fensterinhalte und
verwendet nur `commitText()` mit einem festen Prüftext. Android-Unit-Tests,
Debug-Build und Lint sind erfolgreich; der Debug-Proof-of-Concept ist unter
`ch.voicebridge.app.spike` auf dem A54 installiert und gestartet. Die
manuellen Prüfungen ergaben: Overlay bleibt beim Wechsel zu Gmail sichtbar,
Samsung Keyboard bleibt aktiv, die Pill lässt sich verschieben und ein kurzer
Tap löst weiter nur den Prüftext aus. Der Prüftext wird in den Nachrichtentext
eingefügt und beim Wechsel zum Betreff während der Wartezeit nicht umgeleitet.
Ein Chrome-Login-Passwortfeld wurde erkannt und der Einfügeversuch mit
«Passwortfeld erkannt · Einfügen gesperrt» blockiert. Ein temporärer
Debug-PTT-Modus bestätigte für beide Lautstärketasten gedrückt/losgelassen und
fing die Events ab; beim Loslassen endete der Status. Der Nutzer entschied
sich gegen die Übernahme, damit die Lautstärke bedienbar bleibt. Der aktuelle
Debug-Dienst reicht die Tasten weiter. Android bietet keinen
verlässlichen allgemeinen Push-to-Talk-Hook für beliebige Hardwaretasten.
Die A54-Probe belegt daher nur die Funktion auf diesem Gerät und den
Schlüsselkonflikt, nicht eine universelle Aktivierung. Das Overlay
benötigt eine Systemfreigabe; Einfügung über Bedienungshilfen ist app- und
versionsabhängig und vor einer Veröffentlichung auf Plattform-/Store-
Anforderungen zu prüfen. Ein eigenes IME kann über `InputConnection` direkter
einfügen, ersetzt dafür aber die ausgewählte Tastatur.

**Festgehalten:**
- Der neue Diktatpfad bleibt unabhängig von PC, Profil und Bridge-Client. Die
  bestehende PC-Kopplung wird nicht entfernt oder verändert.
- Direkte OpenAI-Verarbeitung auf Android mit eigenem API-Schlüssel ist der
  vereinbarte Weg. Lokale Speicherung des Schlüssels wird mit AES-GCM und
  Android Keystore geschützt; Schlüssel und Audio werden nicht protokolliert,
  Backups schliessen den Schlüsselciphertext aus.
- Cloud-Upload benötigt vorherige, verständliche Einwilligung. Audio wird
  standardmässig nicht auf Disk geschrieben. Ein Fehler oder ein unsicheres
  Zielfeld darf weder Text verlieren noch auf ein anderes Feld umleiten.
- Diktat sendet keine Aktion wie «Enter» oder «Senden». Passwortfelder werden
  soweit anhand der Android-Feldmerkmale erkennbar gesperrt; vollständige
  Erkennung fremder App-Felder ist nicht garantierbar.
- Der A54-Test bestätigt den Overlay-Weg mit Samsung Keyboard in Gmail.
  Bedienungshilfen-Freigabe, App-Kompatibilitäts- und
  Veröffentlichungsgrenzen bleiben bestehen. Der Nutzer wählte die bewegliche
  Overlay-Pill mit Tap als MVP-Aktivierung; Hardware-PTT über
  Lautstärketasten wird wegen des Lautstärke-Konflikts nicht übernommen.
- Das Overlay soll wie bei Wispr Flow verschiebbar sein. Der Debug-PoC
  implementiert Ziehen mit Positionsbegrenzung und getrenntem Tap; beides ist
  auf dem A54 bestätigt.
- Die Overlay-Pill verwendet einen Tap zum Starten und einen zweiten Tap zum
  Stoppen. Ein dritter, als «An OpenAI senden» beschrifteter Tap gibt die
  Aufnahme einzeln frei; Stoppen allein bedeutet keine Cloud-Einwilligung.
- Der Nutzer hat dem Debug-Test zugestimmt, Lauter/Leiser während des Haltens
  als PTT-Ereignis abzufangen. Das ist nur ein Status-Probe ohne Audio; die
  Lautstärke-Tasten waren währenddessen nicht verfügbar. Der Nutzer wählte
  danach die bewegliche Overlay-Pill als Aktivierung; Hardware-PTT wird nicht
  ins MVP übernommen.
- A54-/One-UI-Gerätetest ist Voraussetzung für die Abnahme, nicht für die
  Erstellung von Unit- und Android-Tests.

**Folgen:** Der neue Debug-Pfad nutzt Android 13+
`InputMethod.AccessibilityInputConnection`, prüft die Editor-Sitzung,
vermeidet Feldinhaltszugriff und ist in Gmail sowie einem Chrome-
Passwortfeld getestet. Die Pill wurde auf dem A54 als verschiebbar bestätigt.
Daraus folgt keine Universalgarantie für weitere Apps. Der Hardware-PTT-
Status wurde mit beiden Lautstärketasten bestätigt, aber nur ohne Audio und
unter Abfangen der Lautstärketasten; er wird nicht ins MVP übernommen. Das
MVP nutzt die bewegliche Overlay-Pill zum Tippen. Ein eigener
Mikrofon-Vordergrunddienst wird nur aus der sichtbaren App gestartet und
bleibt aktiv, solange das Overlay läuft. Dadurch kann die Mikrofonberechtigung
nach dem App-Wechsel weiter genutzt werden; Android zeigt eine dauerhafte
Benachrichtigung und einen Aufnahmeindikator.

Das MVP ergänzt AES-GCM-verschlüsselte API-Key-Ablage mit Android Keystore,
Backup-Ausschluss, RAM-Aufnahme (maximal acht Minuten), OpenAI-Transkription
mit `gpt-4o-transcribe`, Einfügen nach erneuter Editor-Prüfung und ein
Testlabor ohne automatische Einfügung. Audio wird erst nach erfolgreicher
Transkription verworfen. Bei Netzwerk- oder Zielfeldfehlern bleiben Audio
beziehungsweise Text im laufenden Prozess zum Wiederholen, Kopieren oder
Verwerfen erhalten. Ein Zielfeldwechsel beendet bereits laufende Aufnahmen;
eine Teilaufnahme wird nicht automatisch hochgeladen. Der bestehende
PC-Mikrofonmodus bleibt separat verfügbar.
Die Abnahme des vollständigen Aufnahme-/Cloud-/Einfügeablaufs auf dem A54 und
die Prüfung der Plattform-/Store-Anforderungen bleiben offen.

---

## Offen

| # | Frage | Wer/Wann |
|---|---|---|
| O-1 | Was ist Firstmate, hat es eine Schnittstelle? | Stefan |
| O-2 | ~~Audio: Web Audio oder natives Modul?~~ Entschieden in ADR-007 | – |
| O-3 | PTY-Senden: mit Enter (Default) oder als Entwurf? Umgesetzt als Einstellung, Default Enter | M2 |
| O-4 | Lizenz / Sichtbarkeit des Repos | Stefan |
| O-5 | Konfiguration zwischen Profilen exportierbar? | M3 |
