# AGENTS.md – Anleitung für Code-Agents

Voice-Bridge: systemweite Push-to-Talk-Spracheingabe (Diktat am Cursor und Voice-Prompts an Agent-Sessions). Zuerst Windows.

## Lies zuerst

1. [`docs/requirements.md`](docs/requirements.md) – ursprüngliche Anforderungen (verbindlich)
2. [`docs/PLAN.md`](docs/PLAN.md) – Architektur, Schichten, State Machine, Meilensteine
3. [`docs/decisions.md`](docs/decisions.md) – getroffene Entscheide (ADR). Nicht stillschweigend davon abweichen.
4. [`docs/backlog.md`](docs/backlog.md) – Aufgaben mit Abnahmekriterien. **Hier anfangen: T-001, T-002, dann Spikes.**
5. [`docs/ui-spec.md`](docs/ui-spec.md) und [`docs/mockups/`](docs/mockups/index.html) – UI-Referenz

## Stack

Electron · TypeScript (strict) · Svelte 5 (Runes) · electron-vite · Vitest · npm. Native Funktionen nur über koffi, node-pty, uiohook-napi oder einen in CI gebauten Helper. **Keine** Abhängigkeit, die auf dem Entwicklerrechner einen C++/Rust-Compiler braucht.

## Regeln

- **Schichten trennen:** `src/core/` ist reine Logik ohne `electron`- und `node:`-Imports. Alles mit I/O liegt hinter einem Port-Interface (`InputPort`, `RecorderPort`, `SpeechToText`, `AgentAdapter`, `TextInserter`, `Clock`).
- **Keine erfundenen APIs.** Für Firstmate gibt es keinen Adapter, bis eine Schnittstelle belegt ist. Bei Copilot CLI nur dokumentierte Wege (ACP, PTY). Keine Fokus- oder Tastatursimulation, um Agent-Sessions zu erreichen.
- **Nie still umleiten:** Ziel-Sessions werden per ID fixiert. Fehlt die Session, gibt es einen Fehler mit erhaltenem Text, keinen Fallback.
- **Kein Datenverlust:** Bei jedem Fehler bleiben Text bzw. Audio erhalten, bis der Nutzer handelt.
- **Datenschutz:** Audio nie auf Disk (ausser Opt-in), API-Keys nur über `safeStorage`, kein Telemetrie-Code, keine Secrets im Repo.
- **Tests zuerst für `core/`:** Die sechs Pflichtszenarien aus PLAN §7 müssen immer grün sein.
- **Hook-Callbacks** kehren in unter 1 ms zurück: nur Event in die Queue, keine Logik.
- **Overlays** werden einmal erzeugt, danach nur `showInactive()` / `hide()`. Nie `focus()` auf ein Overlay.
- **Sprache:** Code, Bezeichner und Commits auf Englisch. UI-Texte und Doku auf Deutsch (Schweizer Schreibweise, ss statt ß).
- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) (Angular-Stil): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `ci:`, `build:`, `chore:`. commitlint prüft das im `commit-msg`-Hook und in der CI; release-please leitet daraus Version und Changelog ab.
- **Quality Gates:** vor dem Push müssen `npm run lint`, `npm run knip`, `npm run typecheck` und `npm run test:coverage` grün sein (`src/core` ≥ 90 % Abdeckung).
- **Spikes** landen in `spikes/<name>/`, Ergebnis als Eintrag in `docs/decisions.md`.
- Bei einer Abweichung vom Plan: ADR ergänzen, nicht still ändern.
- **HTML-Links** (z. B. Mockups) in README und Doku über githack setzen, damit sie gerendert werden: `https://raw.githack.com/stefaneicher/voice-bridge/main/<pfad>.html`.

## Befehle (nach T-001)

```bash
npm install
npm run dev        # Electron mit Hot Reload
npm test           # Vitest
npm run test:coverage   # mit Abdeckungs-Gate für src/core
npm run test:e2e   # App-Starttest (nach npm run build; unter Linux mit xvfb-run)
npm run knip       # ungenutzter Code und Abhängigkeiten
npm run lint
npm run build      # Paket für das aktuelle Betriebssystem
```

## Profile

`--profile privat` bzw. `--profile citrix`: getrennte Konfiguration, Secrets, Pipe-Namen und Instanz-Locks (ADR-006).
