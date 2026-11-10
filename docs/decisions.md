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

## Offen

| # | Frage | Wer/Wann |
|---|---|---|
| O-1 | Was ist Firstmate, hat es eine Schnittstelle? | Stefan |
| O-2 | Audio: Web Audio im versteckten Renderer oder natives Modul? | Spike S1/M1 |
| O-3 | PTY-Senden: mit Enter (Default) oder als Entwurf? | M2, konfigurierbar |
| O-4 | Lizenz / Sichtbarkeit des Repos | Stefan |
| O-5 | Konfiguration zwischen Profilen exportierbar? | M3 |
