# Voice-Bridge – Implementierungs-Prompt

Entwickle **Voice-Bridge**, eine schlanke Windows-Anwendung für systemweite Push-to-Talk-Spracheingabe. Dieselbe Anwendung soll **privat und im geschäftlichen Citrix-Setup** separat nutzbar sein (jeweils eigene Konfiguration/Sessions).

## Anforderungen

1. **Zwei konfigurierbare Hotkeys/Maustasten** (auch Zusatztasten einer Maus):
   - **Diktat:** Taste halten → Sprache aufnehmen → loslassen → transkribierten Text an der aktuellen Cursorposition einfügen (ohne automatisches Absenden).
   - **Agent:** Taste halten → Sprache aufnehmen und **sofort ein kleines, unaufdringliches Session-Popup** anzeigen. Beim Loslassen transkribieren und den Text an die dann ausgewählte Agent-Session senden.
2. **Session-Auswahl während der Aufnahme:** Popup zeigt laufende Sessions (z. B. fünf). Mit **Mausrad** zwischen ihnen wechseln; die **beim Loslassen markierte Session** ist das Ziel. Alternativ per **Mausklick** eine Session auswählen/öffnen, während die Aufnahme ununterbrochen weiterläuft. Keine feste Default-Session erforderlich.
3. **Kein Fokuswechsel nötig** für die Übermittlung an Agent-Sessions. Die Eingabe muss an die richtige Session gehen, auch wenn deren Fenster nicht aktiv ist. Eine verschwundene Session darf nicht stillschweigend durch eine andere ersetzt werden. Bei Fehlern Text erhalten und Wiederholen/Kopieren anbieten.
4. **Austauschbare Speech-to-Text-Engine**: zunächst OpenAI-Transkriptions-API, später lokale Engine möglich. **Schweizerdeutsch zuverlässig erkennen**, Ausgabe vorzugsweise als gut lesbares **Hochdeutsch**; Rohtranskript optional. Modell und Sprache konfigurierbar.
5. **Agent-Adapter**: zunächst **GitHub Copilot CLI / Firstmate**, technisch möglichst über eine stabile Session-Schnittstelle statt Fokus-/Tastatursimulation; spätere Adapter vorsehen. Pro Instanz Sessions ihrer jeweiligen Umgebung erkennen/konfigurieren.
6. **Bedienung**: Tray-App, frei belegbare Hotkeys, Mikrofon-/Aufnahmeindikator, Session-Popup bei Agent-Taste, minimale Latenz. Aufnahme endet ausschließlich mit Loslassen der gehaltenen Taste; Scrollen oder Klicken unterbricht sie nicht.
7. **Sicherheit & Betrieb**: API-Key sicher speichern; keine dauerhafte Audiospeicherung per Default; Cloud-Nutzung transparent/konfigurierbar. Für Citrix explizit prüfen: Hotkey-Erkennung, Mikrofonzugriff, Zwischenablage/Fokuskontrolle und erlaubte Session-Anbindung; Einschränkungen dokumentieren.

## Gewünschte Umsetzung

- Erstelle eine **lauffähige, möglichst einfache MVP-Version** samt Quellcode, README, Start-/Build-Anleitung und Beispielschema für Sessions/Adapter.
- Trenne **Hotkey-/UI-Schicht**, **Audioaufnahme**, **Transkription** und **Session-Routing** sauber voneinander.
- Beginne mit Windows lokal; entwerfe Citrix-Unterstützung ohne unbewiesene Funktionsgarantien. Nutze für das Popup die aktuell verfügbaren Sessions, nicht hardcodierte Einträge.
- Lege Tests an für: Taste halten/loslassen, Scroll-Auswahl beim Loslassen, Klickwechsel während Aufnahme, verschwundene Session, fehlgeschlagene Transkription und Einfügen am Cursor.
- Dokumentiere offene technische Entscheidungen und verwende bei nicht vorhandener Firstmate-/Copilot-Schnittstelle einen klar abgegrenzten Adapter statt eine API zu erfinden.
