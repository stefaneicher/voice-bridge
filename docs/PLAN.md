# Voice-Bridge – Umsetzungsplan

Stand: 10.11.2026 · Status: Entwurf vor Spike-Phase
Anforderungen: [requirements.md](requirements.md) · Mockups: [mockups/](mockups/index.html) · UI: [ui-spec.md](ui-spec.md) · Entscheide: [decisions.md](decisions.md) · Aufgaben: [backlog.md](backlog.md) · Citrix: [citrix.md](citrix.md)

---

## 1. Technologie-Entscheid

**Empfehlung: Electron + TypeScript (Node 22 LTS), UI mit Svelte 5 über electron-vite, Build mit npm.**

Entscheidend ist die Firmenumgebung. Dort ist **npm verfügbar**, eine Rust- oder C++-Toolchain vermutlich nicht. Mit Electron baut und startet alles mit `npm install` und `npm run dev`. Native Teile kommen als Prebuilds über npm oder werden in GitHub Actions gebaut, nie auf dem Firmenrechner.

### Vergleich

| Kriterium | **Electron + TS** | Tauri 2 (Rust + TS) | .NET Avalonia | Java/JavaFX |
|---|---|---|---|---|
| Build in der Firma | **nur npm** | Rust + MSVC Build Tools nötig | .NET SDK nötig | JDK + JNativeHook |
| Transparente Overlays, immer im Vordergrund | ja, ausgereift | ja | ja | eingeschränkt |
| Overlay ohne Fokusdiebstahl | `focusable:false`, `showInactive()` | über native Window-Styles | über native Styles | schwierig |
| Globaler Maus-/Tasten-Hook | uiohook-napi; Unterdrücken über Win32-Hook (koffi) | rdev / eigener Hook | SharpHook | JNativeHook |
| ACP-Client (Copilot CLI) | **offizielles TS-SDK** `@agentclientprotocol/sdk` | Rust-Crate | selbst bauen | selbst bauen |
| PTY für Terminal-Sessions | node-pty (VS Code nutzt es) | portable-pty | Pty.Net | pty4j |
| Grösse / RAM | ~100 MB / ~150 MB | ~10 MB / ~40 MB | ~60 MB | ~80 MB + JVM |
| Referenzprojekt | **OpenWhispr** (Electron) | Handy (Tauri) | – | – |

**Preis von Electron:** grösseres Paket und mehr RAM. In Citrix-VDI kann das spürbar sein. Ausgleich: nur eine Instanz pro Profil, Fenster werden einmal erzeugt und dann nur ein- und ausgeblendet.

**Warum Svelte statt Angular:** Die Overlays sind vier sehr kleine Fenster. Bei Svelte ist die Startzeit kurz und der Code wenig. electron-vite unterstützt Svelte direkt, Angular nicht. Angular wäre möglich, bringt hier aber nur Tooling-Reibung. Die Logik liegt ohnehin UI-unabhängig in `core/`.

**Ausweg später:** Ist das Paket in Citrix zu gross, lässt sich die UI-unabhängige Kernlogik (TS) behalten und nur die Shell wechseln. Ein Kandidat ist Tauri mit TS-Sidecar. Das ist kein Teil des MVP.

---

## 2. Architektur

```
┌──────────────────────── Electron Main Process ─────────────────────────┐
│                                                                         │
│  input/        audio/          stt/             agents/       output/   │
│  InputHook ──► Recorder ──►   SpeechToText ──► Router ──►   TextInserter│
│  (Hold/Wheel/  (Mic, PCM,     (OpenAI,         │  AgentAdapter[]        │
│   Click)       Pegel)          später lokal)   │   ├ PtyBridgeAdapter   │
│       │                                        │   ├ AcpAdapter         │
│       ▼                                        │   └ (Firstmate: offen) │
│  core/  SessionController (State Machine, rein, testbar)               │
│       │                                                                 │
│       ▼ IPC (Events)                                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  Renderer (Svelte):  Pill · SessionPopup · Toast · Settings · Tray      │
└─────────────────────────────────────────────────────────────────────────┘
            ▲ Named Pipe / Unix Socket (pro Profil)
            │
   vb run -- copilot      ← Wrapper-CLI (PTY), registriert Session
```

### Schichten (wie gefordert getrennt)

| Modul | Aufgabe | Abhängigkeiten |
|---|---|---|
| `core/` | State Machine, Session-Auswahl, Fehlerlogik. **Keine I/O.** | keine |
| `input/` | globale Hotkeys und Maustasten, Mausrad während Hold, Unterdrücken der Originalevents | uiohook-napi, koffi (Win32) |
| `audio/` | Aufnahme 16 kHz mono, Pegel, Ringpuffer nur im RAM | Web Audio in verstecktem Renderer oder `naudiodon` (Spike) |
| `stt/` | Interface `SpeechToText`, Umsetzung `OpenAiTranscriber`, später `LocalWhisper` | fetch |
| `agents/` | Interface `AgentAdapter`, Session-Registry | node-pty, ACP-SDK |
| `output/` | Einfügen am Cursor | Zwischenablage + simuliertes Ctrl+V |
| `ui/` | Svelte-Fenster, nur Darstellung, Status kommt per IPC | Svelte |
| `cli/` | `vb run`: Wrapper für Terminal-Agents | node-pty |

### State Machine (`core/`)

```
Idle ──hold(Diktat)──► Recording(dictate) ──release──► Transcribing ──► Inserting ──► Done
Idle ──hold(Agent)───► Recording(agent, selection) ─┬─ wheel ─► selection ±1
                                                   ├─ click ─► selection = X (Aufnahme läuft weiter)
                                                   └─ release ─► target = selection (fixiert per ID)
                                                                 ──► Transcribing ──► Delivering ──► Done
jeder Fehler ─► Failed(text?, audio?, target?)  → Retry | Andere Session | Kopieren | Verwerfen
```

Regeln:

- Nur das Loslassen der gehaltenen Taste beendet die Aufnahme. Scroll und Klick ändern nur die Auswahl.
- Das Ziel wird beim Loslassen als **Session-ID** fixiert, nicht als Listenindex.
- Ist die Ziel-Session beim Senden weg, gibt es `Failed(SessionGone)`. **Nie** auf eine andere Session ausweichen.
- Watchdog: Ein verpasstes Release-Event (z. B. UAC- oder Secure-Desktop-Wechsel) beendet die Aufnahme nach max. 120 s und prüft den Tastenstatus per `GetAsyncKeyState`.

---

## 3. Kritische technische Punkte

### 3.1 Maustasten abfangen und unterdrücken

Maus 4/5 bedeuten in Browsern «Zurück/Vor». Das Mausrad scrollt während der Agent-Aufnahme sonst das Fenster darunter. Beides muss **verschluckt** werden. uiohook-napi kann nur zuhören, nicht blockieren.

- **Windows:** eigener `WH_MOUSE_LL`- und `WH_KEYBOARD_LL`-Hook über **koffi** (FFI, als npm-Prebuild verfügbar, kein Compiler nötig). Der Hook gibt für konfigurierte Tasten und für das Mausrad während der Agent-Aufnahme `1` zurück.
  - Fallback: ein kleines Helper-Programm (C oder C#), das **in GitHub Actions** gebaut und mitgeliefert wird.
- **macOS:** CGEventTap braucht die Freigabe «Bedienungshilfen». Später, gleicher Fallback-Weg.
- **Linux:** X11 geht, Wayland erlaubt keine globalen Hooks. Dokumentieren, nicht garantieren.

### 3.2 Overlays ohne Fokuswechsel

- Pill, Popup und Toast werden beim Start **einmal erzeugt** und danach nur ein- und ausgeblendet. So erscheint das Popup in unter 50 ms.
- Fenster-Optionen: `transparent: true`, `frame: false`, `focusable: false`, `skipTaskbar: true`, `alwaysOnTop: 'screen-saver'`, anzeigen mit `showInactive()`.
- Die Pill lässt Klicks durch (`setIgnoreMouseEvents(true)`). Das Popup nimmt Klicks an, aktiviert sich aber nicht. Unter Windows wird das per `WS_EX_NOACTIVATE` geprüft (Spike S2).
- Position: beim Mauszeiger, auf den Bildschirmrand begrenzt, DPI-korrekt bei mehreren Monitoren.
- Ohne Fokuswechsel bleibt die Cursor-Position im Zielprogramm für das Diktat erhalten.

### 3.3 Agent-Anbindung: Fakten und Konsequenz

- Copilot CLI hat seit Januar 2026 einen **ACP-Server** (`copilot --acp --stdio` bzw. `--port`), derzeit Public Preview.
- **Aber:** ACP öffnet eigene Sessions. An eine laufende **interaktive** TUI-Session andocken kann man nicht (in der GitHub Community als Wunsch offen).
- **Firstmate:** keine öffentliche Schnittstelle gefunden. Bleibt ein offener Punkt. Es kommt **kein** erfundener Adapter, nur das Interface.

Deshalb zwei Adapter, beide ohne Fokus- oder Tastatursimulation:

| Adapter | Funktionsweise | Wann sinnvoll |
|---|---|---|
| **PtyBridgeAdapter** (MVP) | Statt `copilot` startet man `vb run -- copilot`. Der Wrapper startet Copilot in einer Pseudo-Konsole (node-pty, ConPTY), reicht alles 1:1 ins Terminal durch und meldet sich mit Name, Arbeitsverzeichnis und PID per Named Pipe bei Voice-Bridge an. Voice-Bridge schreibt Text direkt in den Eingang der Session (Bracketed Paste, dann Enter). Ende des Prozesses bedeutet Session weg. | Normale interaktive Nutzung im Terminal, mehrere Tabs, Fenster muss nicht aktiv sein |
| **AcpAdapter** | Voice-Bridge startet `copilot --acp` selbst und verwaltet Sessions über das offizielle TS-SDK. Antworten erscheinen in einem kleinen Voice-Bridge-Fenster. | Headless, später auch andere ACP-Agents (z. B. Claude Code, Gemini CLI) |

Interface (Entwurf):

```ts
interface AgentAdapter {
  readonly id: string;                       // "pty-bridge", "acp-copilot"
  listSessions(): Promise<SessionInfo[]>;     // aktuell verfügbare, keine Hardcodes
  onChange(cb: (s: SessionInfo[]) => void): Unsubscribe;
  send(sessionId: string, text: string): Promise<DeliveryResult>; // wirft nie still um
  reveal?(sessionId: string): Promise<void>; // «Session zeigen», optional
}
type DeliveryResult = { ok: true } | { ok: false; reason: 'gone' | 'busy' | 'io'; detail?: string };
```

### 3.4 Speech-to-Text für Schweizerdeutsch

- Die OpenAI-API kennt kein Sprachkürzel für Schweizerdeutsch. Deshalb **zwei Stufen**, einzeln konfigurierbar:
  1. **Transkription** (`gpt-4o-transcribe`, Fallback `whisper-1`) mit `language=de` und einem Prompt mit Glossar und Hinweis auf Dialekt. Ergebnis ist das **Rohtranskript**.
  2. **Glättung** (optional, standardmässig aus, kleines Chat-Modell): Dialekt ins Schweizer Hochdeutsch (ss statt ß), Füllwörter weg, Inhalt unverändert.
- Ob eine Stufe reicht, entscheidet ein Messvergleich mit 20 eigenen Berndeutsch-Aufnahmen (Spike S4).
- Lokale Engine später über dasselbe Interface (whisper.cpp oder Parakeet über sherpa-onnx, wie bei OpenWhispr).

### 3.5 Einfügen am Cursor

1. Zwischenablage sichern.
2. Text setzen, Ctrl+V simulieren (Win32 `SendInput` über koffi).
3. Nach ca. 300 ms die ursprüngliche Zwischenablage wiederherstellen.
4. Fallback: Unicode-Tippen per `SendInput` (langsamer, aber ohne Zwischenablage).
5. Kein Textfeld erkennbar: Text in der Zwischenablage lassen und Hinweis anzeigen (siehe Mockup 3a).
6. **Kein Enter.** Diktat sendet nie automatisch ab.

---

## 4. Profile: Privat und Citrix

- Start mit `voice-bridge --profile privat` oder `--profile citrix`.
- Pro Profil getrennt:
  - Konfigurationsordner
  - Eintrag im Windows-Tresor (API-Key, über Electron `safeStorage`)
  - Name der Named Pipe (`\\.\pipe\voice-bridge-<profil>`)
  - Session-Liste und Verlauf
- Zwei Instanzen auf demselben Rechner stören sich nicht (Single-Instance-Lock pro Profil).

---

## 5. Sicherheit und Betrieb

- API-Key nur über `safeStorage` (DPAPI), nie im Klartext in der Konfiguration.
- Audio nur im RAM.
  - Nach erfolgreicher Transkription sofort verworfen.
  - Bei einem Fehler bis zum Schliessen der Meldung gehalten.
  - Speichern auf Disk nur per Opt-in.
- Cloud-Nutzung sichtbar: Badge «Cloud» im Tray, Hinweis in den Einstellungen, pro Profil abschaltbar.
- Verlauf (Text) lokal, Länge konfigurierbar, löschbar.
- Kein Telemetrie-Code.

---

## 6. Citrix: zu prüfen (ohne Garantie)

| Thema | Frage | Test |
|---|---|---|
| Hotkeys | Kommen Maus 4/5 und das Mausrad in der Citrix-Session an? Lassen sie sich dort unterdrücken? | Hook-Logger in der Session, verschiedene Workspace-App-Versionen |
| Mikrofon | Ist HDX-Audio-Umleitung per Policy erlaubt? Welche Latenz und Qualität? | Testaufnahme, Pegel, Vergleich mit lokal |
| Netzwerk | Ist `api.openai.com` vom VDA erreichbar? Proxy, TLS-Inspection? | Verbindungstest in den Einstellungen |
| Zwischenablage / Einfügen | Funktioniert SendInput in der Session? Wird die Zwischenablage zwischen Client und VDA synchronisiert? | Einfügen in Notepad, Outlook, Browser |
| Sessions | Läuft das Terminal mit Copilot **in derselben** VDA-Session? Named Pipe nur innerhalb der Session | `vb run` im Citrix-Terminal |
| Installation | Portable `.exe` ohne Admin-Rechte erlaubt? AppLocker? | Portable Build aus GitHub Actions |
| npm | Funktioniert `npm install` mit Prebuilds (koffi, node-pty, uiohook-napi) hinter dem Firmen-Proxy? | Spike S0 |

Ergebnisse kommen nach `docs/citrix.md`, auch die Einschränkungen.

---

## 7. Tests

Die Logik liegt in `core/`. Deshalb laufen die geforderten Fälle als schnelle Unit-Tests mit Fakes (Fake-Hook, Fake-Uhr, Fake-STT, Fake-Adapter) unter **Vitest**:

| Geforderter Test | Prüft |
|---|---|
| Taste halten/loslassen | Aufnahme startet bei Down und endet nur bei Up derselben Taste |
| Scroll-Auswahl beim Loslassen | 3× Rad runter, dann Release ergibt Ziel = Session 4 (per ID) |
| Klickwechsel während Aufnahme | Klick auf Session 2 ändert das Ziel, die Aufnahme läuft weiter, der Audiopuffer wächst |
| Verschwundene Session | Ziel weg vor dem Senden ergibt `Failed(gone)`, keine andere Session erhält Text, der Text bleibt erhalten |
| Fehlgeschlagene Transkription | STT-Timeout ergibt `Failed(stt)`, Audio bleibt erhalten, Retry funktioniert |
| Einfügen am Cursor | Inserter erhält den Text, kein Enter, Zwischenablage wird wiederhergestellt |

Weitere Tests:

- **Integration:** `vb run -- node echo-agent.js` mit einem Test-Programm, das Eingaben zurückgibt. Prüft Registrierung, Senden und Abmeldung.
- **UI:** Svelte-Komponenten (Popup-Auswahl, Fehler-Toasts) mit Vitest + Testing Library.
- **CI:** GitHub Actions, Matrix Windows/macOS/Linux für Tests, Release-Build als portable `.exe` und Installer.

---

## 8. Repo-Struktur (Ziel)

```
voice-bridge/
├─ src/
│  ├─ core/        State Machine, Routing (rein)
│  ├─ input/       Hooks (win32 via koffi, uiohook fallback)
│  ├─ audio/
│  ├─ stt/         openai.ts, (local.ts)
│  ├─ agents/      pty-bridge/, acp/, registry.ts
│  ├─ output/      inserter.ts
│  ├─ main/        Electron-Main, Fenster, Tray, IPC, Profile
│  ├─ renderer/    Svelte: pill/, popup/, toast/, settings/
│  └─ cli/         vb run
├─ test/           unit/, integration/
├─ docs/          requirements.md, PLAN.md, decisions.md, backlog.md, ui-spec.md, citrix.md, mockups/
├─ examples/      config / adapters / sessions / pipe-protocol Beispiele
└─ package.json
```

---

## 9. Meilensteine

| # | Inhalt | Ergebnis |
|---|---|---|
| **S0** | npm-Spike Firma: `npm install` mit koffi, node-pty, uiohook-napi hinter Proxy | Ja/Nein für den Stack |
| **S1** | Win32-Hook über koffi: Maus 4/5 und Mausrad erkennen **und unterdrücken** | Log-Demo |
| **S2** | Transparentes Popup ohne Fokusdiebstahl, Klick ohne Aktivierung | Demo-Fenster |
| **S3** | `vb run -- copilot`: Text injizieren, während ein anderes Fenster aktiv ist | Demo |
| **S4** | STT-Vergleich Berndeutsch: eine vs. zwei Stufen, Modelle, Latenz | Tabelle in `decisions.md` |
| **M1** | Diktat end-to-end auf Windows: Tray, Pill, Einfügen, Fehler | nutzbar privat |
| **M2** | Agent: Popup, Rad/Klick, PtyBridge, Fehlerfälle | nutzbar mit Copilot CLI |
| **M3** | Einstellungen, Profile, safeStorage, Verlauf | Citrix-Profil testbar |
| **M4** | Citrix-Testlauf, `docs/citrix.md` | dokumentierte Grenzen |
| **M5** | AcpAdapter | zweiter Adapter |
| **M6** | macOS/Linux, lokale Engine | optional |

---

## 10. Offene Entscheidungen

1. **Firstmate:** Was genau ist es, und hat es eine Schnittstelle (CLI, Socket, Datei)? Bis zur Klärung nur Platzhalter im Interface.
2. **Audio-Aufnahme:** Web Audio im versteckten Renderer (kein natives Modul) oder `naudiodon`? Startlatenz messen.
3. **STT ein- oder zweistufig**, siehe S4.
4. **Senden an PTY-Sessions:** sofort mit Enter oder als Entwurf ohne Enter? Konfigurierbar pro Adapter, Default: senden.
5. **Lizenz und Sichtbarkeit** des Repos: privat, später MIT?
6. **Gemeinsame Konfiguration** privat/geschäftlich: Export/Import oder strikt getrennt?
