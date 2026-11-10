# Voice-Bridge

Systemweite Push-to-Talk-Spracheingabe für Windows. Schweizerdeutsch rein, Hochdeutsch raus.

## Benutzung

**Diktat:** Diktat-Taste halten, sprechen, loslassen. Der Text erscheint am Cursor, ohne automatisches Absenden.

**Agent:** Agent-Taste halten und sprechen. Beim Zeiger erscheint ein Popup mit den laufenden Agent-Sessions. Mit dem Mausrad oder per Klick die Session wählen. Beim Loslassen geht der Prompt an die markierte Session, ohne Fokuswechsel.

Damit eine Session in der Liste erscheint, den Agent über Voice-Bridge starten:

```bash
vb run -- copilot
```

Beide Tasten sind frei belegbar (auch Zusatztasten der Maus). Einstellungen über das Tray-Icon.

## Mockups

Alle Mockups im Browser öffnen: [docs/mockups/index.html](docs/mockups/index.html)

| Mockup | Inhalt |
|---|---|
| [1a](docs/mockups/1a-diktat-aufnahme.html) | Diktat: Aufnahme läuft |
| [1b](docs/mockups/1b-diktat-eingefuegt.html) | Diktat: Text eingefügt |
| [2a](docs/mockups/2a-agent-session-popup.html) | Agent: Session-Popup |
| [2b](docs/mockups/2b-agent-gesendet.html) | Agent: Prompt gesendet |
| [3a](docs/mockups/3a-fehlerfaelle.html) | Fehlerfälle |
| [3b](docs/mockups/3b-tray-menue.html) | Tray-Menü |
| [3c](docs/mockups/3c-einstellungen.html) | Einstellungen |
