# Voice-Bridge

Systemweite Push-to-Talk-Spracheingabe für Windows (später macOS/Linux).

- **Diktat:** Taste halten, sprechen, loslassen. Der Text erscheint am Cursor, ohne automatisches Absenden.
- **Agent:** Taste halten. Ein Session-Popup erscheint, Mausrad oder Klick wählt die Session. Beim Loslassen geht der Prompt an die gewählte Agent-Session (z. B. GitHub Copilot CLI), ohne Fokuswechsel.

Schweizerdeutsch rein, Hochdeutsch raus. Getrennte Profile für privat und Citrix.

## Status

Planung abgeschlossen, Umsetzung startet mit [Backlog](docs/backlog.md) T-001.

## Dokumentation

| Dokument | Inhalt |
|---|---|
| [docs/requirements.md](docs/requirements.md) | Anforderungen |
| [docs/PLAN.md](docs/PLAN.md) | Architektur, Technik, Meilensteine |
| [docs/decisions.md](docs/decisions.md) | Entscheide (ADR) und offene Fragen |
| [docs/backlog.md](docs/backlog.md) | Aufgaben mit Abnahmekriterien |
| [docs/ui-spec.md](docs/ui-spec.md) | Design-Tokens, Fenster, Verhalten |
| [docs/mockups/](docs/mockups/index.html) | HTML-Mockups aller Use Cases (im Browser öffnen) |
| [docs/citrix.md](docs/citrix.md) | Citrix-Testprotokoll |
| [examples/](examples/) | Beispiel-Konfiguration, Adapter, Sessions, Pipe-Protokoll |
| [AGENTS.md](AGENTS.md) | Regeln für Code-Agents |

## Stack

Electron · TypeScript · Svelte 5 · electron-vite · Vitest · npm
