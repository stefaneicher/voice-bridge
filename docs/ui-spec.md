# UI-Spezifikation

Abgeleitet aus den Mockups in [`mockups/`](mockups/index.html). Die Mockups sind die visuelle Referenz. Diese Datei hält fest, was sich daraus nicht direkt ablesen lässt: Verhalten, Masse, Zustände.

## Design-Tokens

Seit ADR-014 im Stil von [stefaneicher.github.io](https://stefaneicher.github.io/) (Disroop). Gilt für Desktop-App, Android-App, Webseite und Grafiken.

| Token | Wert | Verwendung |
|---|---|---|
| `--vb-ink` | `#15151C` | Hintergrund aller Overlays, Einstellungen, Android-App |
| `--vb-ink-2` | `#1D1D27` | Flächen (Panel), Footer, Eingabefelder |
| `--vb-ink-3` | `#24242F` | Eingebettete Boxen (Transkript, Zeilen) |
| `--vb-line` | `#2E2E3B` | 1-px-Rahmen |
| `--vb-text` | `#EDF6F3` | Primärtext |
| `--vb-text-2` | `#C6CAD3` | Sekundärtext |
| `--vb-text-3` | `#9A9CAB` | Labels, Metadaten |
| `--vb-dim` | `#686A7A` | Sehr dezente Texte (Version, Fusszeile) |
| `--vb-dictate` | `#2AA5A1` | Akzent Diktat (Teal) |
| `--vb-agent` | `#A3D858` | Akzent Agent (Lime) |
| `--vb-blue` | `#245E71` | Ergänzungsfarbe (Verläufe, Logo) |
| `--vb-on-accent` | `#0D1716` | Text auf Teal oder Lime |
| `--vb-rec` | `#FF5A5F` | Aufnahmepunkt, Fehler |

Schriften: **Inter** (UI, Titel in 800), **JetBrains Mono** (Session-Namen, Timer, Terminal, Labels). Mit der App ausliefern, nicht von Google Fonts laden (offline und Citrix).

Radien: Pill 30 px (halbe Höhe), Popup und Toast 16 px, Buttons 12 px, Zeilen 10 px. Schatten: `0 24px 70px rgba(0,0,0,.6)`.

Icons: Inline-SVG mit Strich (Lucide-Stil, 2 px), keine Emojis.

## Fenster

Alle Overlays werden beim Start einmal erzeugt und danach nur ein- und ausgeblendet.

| Fenster | Grösse | Position | Fokus | Klicks |
|---|---|---|---|---|
| Diktat-Pill | Inhalt, Höhe 60 px | unten mittig, 92 px über der Taskleiste, auf dem Monitor mit dem Mauszeiger | nie | gehen durch (`setIgnoreMouseEvents(true)`) |
| Session-Popup | 420 × variabel (max. 8 Zeilen, dann scrollt die Liste) | oben links 16 px rechts unterhalb des Zeigers, auf den Monitor begrenzt | nie | angenommen, ohne Aktivierung |
| Toast (Erfolg) | 400–520 px breit | unten mittig (Diktat) bzw. unten rechts (Agent) | nie | angenommen |
| Fehler-Dialog | 360 px | wie Toast | nie, ausser «Andere Session wählen» | angenommen |
| Tray-Flyout | 400 px | über dem Tray-Icon | normal | normal |
| Agent Desk (Hauptfenster, enthält die Einstellungen) | 1200 × 780, skalierbar, min. 760 × 480 | zentriert | normales Fenster | normal |

## Verhalten

### Diktat (Mockups 1a, 1b)

1. Taste unten: Pill sofort einblenden (Ziel unter 50 ms), roter Punkt pulsiert, Timer läuft, Wellenform folgt dem Pegel.
2. Taste oben: Wellenform stoppt, Pill zeigt «Transkribiere …» mit Spinner.
3. Erfolg: Text wird eingefügt, Toast «Eingefügt · N Wörter · x,x s» für 2,5 s, dann ausblenden. Hover hält ihn offen.
4. Rohtranskript nur, wenn in den Einstellungen aktiviert. Dann als Karte über dem Toast.
5. Unter 300 ms gehalten: als versehentlich werten, nichts senden, keine Meldung.
6. Esc während Aufnahme oder «Transkribiere …»: Lauf verwerfen, laufende Transkription abbrechen, nichts einfügen, keine Meldung. Esc wird nur in diesen Phasen abgefangen, sonst geht es normal an die App. Beim Einfügen bzw. Senden ist es zu spät.

### Agent (Mockups 2a, 2b)

1. Taste unten: Popup sofort beim Zeiger, Liste aus `listSessions()` aller aktiven Adapter. Vorauswahl ist die zuletzt verwendete Session, sonst die erste.
2. Mausrad: ±1, zyklisch, entprellt mit 120 ms. Die Rad-Events gehen **nicht** an das Fenster darunter.
3. Klick auf eine Zeile wählt sie. Die Aufnahme läuft weiter, das Popup bleibt offen.
4. Ändert sich die Session-Liste während der Aufnahme, bleibt die Auswahl an der **ID** hängen. Verschwindet die gewählte Session, wird sie durchgestrichen und mit «beendet» markiert. Sie bleibt markiert, es wird nicht automatisch umgewählt.
5. Taste oben: Ziel-ID fixieren, Popup weg, kleiner Status «Sende an X …», danach Toast 2b.
6. Keine Sessions: Popup zeigt «Keine Sessions gefunden» und den Hinweis `vb run -- copilot`. Die Aufnahme läuft trotzdem. Beim Loslassen erscheint der Fehler-Dialog mit «Kopieren».
7. Letzte Zeile «＋ Neue Session» mit «in ‹Ordner›» (Ordner der gewählten bzw. zuletzt verwendeten Session, ADR-017): gestrichelter Rahmen, gedämpfte Farbe, «＋» statt Status-Punkt, gewählt mit «Ziel»-Badge. Wählbar wie jede Zeile. Ausgeblendet ohne bekannten Ordner oder ohne Terminal-Starter. Loslassen öffnet ein Terminal mit Copilot im Ordner; Status «Starte Session in ‹Ordner› …», dann Toast 2b. Nach 20 s ohne bereite Session Fehler «Neue Session nicht bereit» mit «Im Terminal bestätigen».

### Fehler (Mockup 3a)

Jeder Fehler zeigt den Text bzw. die Aufnahme und bietet mindestens **Kopieren** und **Verwerfen**. Der Dialog bleibt, bis der Nutzer handelt. Er schliesst nicht automatisch.

| Fehler | Primäraktion | Weitere Aktionen |
|---|---|---|
| Session weg | Andere Session wählen | Kopieren, Verwerfen |
| STT fehlgeschlagen | Erneut versuchen | Abspielen, Verwerfen |
| Kein Textfeld | OK (Text liegt in der Zwischenablage) | Verlauf öffnen |
| Senden fehlgeschlagen (I/O) | Erneut senden | Kopieren, Verwerfen |
| Neue Session nicht bereit | Nochmals (wartet weiter) | Kopieren, Verwerfen |

### Tray (Mockup 3b)

- Icon-Zustände: bereit (grau), Diktat-Aufnahme (Mint + roter Punkt), Agent-Aufnahme (Amber + roter Punkt), pausiert (durchgestrichen), Fehler (rot).
- Profilwechsel startet die andere Profil-Instanz bzw. holt sie in den Vordergrund. Eine Instanz wechselt nie das eigene Profil im Betrieb.

### Agent Desk (Hauptfenster, ADR-018)

Fenstertitel «Agent Desk». Öffnet beim Start (ausser «Beim Start im Tray bleiben»), über das Tray-Menü und bei einem zweiten Start. ✕ schliesst nur das Fenster.

```
┌────┬──────────────┬──────────────────────────────┬────────────────┐
│ ☰  │ SESSIONS  ＋ │ Ziel: copilot · voice-bridge │ INSPEKTOR      │
│ ▤  │ ● copilot    │ ── Verlauf ──────────────── │ [Session|Einst]│
│ ⚙  │   bereit     │ 14:02  Erkläre den Test …    │ Titel, ID,     │
│    │ ○ claude     │                              │ Ordner, Status │
│    │   beschäftigt│ ┌──────────────────────────┐ │ Schnellschalter│
│    │              │ │ Prompt …        Senden ⏎ │ │                │
└────┴──────────────┴──────────────────────────────┴────────────────┘
 44px   260px            flexibel                   340px (Einst. 460px)
```

- **Werkzeugleiste (44 px):** Sessions ein/aus, Composer, ⚙ (öffnet den Inspektor mit dem Reiter «Einstellungen»).
- **Einklappen (Variante B «Schiene»):** Sessions und Inspektor werden zu einer 28 px breiten Schiene mit senkrechtem Titel. Klick auf die Schiene klappt auf, «‹»/«›» im Kopf klappt ein. Zustand pro Profil gespeichert.
- **Sessions:** Zeile mit Name, Ordner (letzter Teil des Pfads) und Status-Punkt: bereit (Mint), beschäftigt (Amber), getrennt (Rot, durchgestrichen), unbekannt (grau). Die fixierte Session trägt das Badge «Ziel». Klick fixiert per ID. «＋ Neue Session» startet ein Terminal im Ordner der fixierten (sonst ersten) Session (T-026); «…» daneben bzw. ohne bekannten Ordner fragt zuerst nach dem Ordner. Ohne Starter ist die Aktion ausgeblendet.
- **Composer:** Kopfzeile «Ziel: ‹Session›», darüber der Verlauf dieses Laufs (Zeit, Session, Text; Klick übernimmt den Text ins Feld). Strg+Enter oder «Senden» schickt den Text; Pfeil hoch/runter im leeren Feld blättert im Verlauf. Fehler erscheinen unter dem Feld, der Text bleibt stehen. Diktat bei aktivem Composer landet im Feld.
- **Inspektor:** Reiter «Session» (Titel, ID, Ordner, Status, «Terminal anzeigen», Schnellschalter Live-Transkription, Hochdeutsch, Rohtranskript) und «Einstellungen» (die bestehenden Einstellungen, kompakt mit Reitern oben).

## Barrierefreiheit

- Overlays mit `role="status"` bzw. `role="alertdialog"`, Popup als `listbox`.
- Kontrast ≥ 4.5:1 auch für 11-px-Labels.
- `prefers-reduced-motion`: keine Puls- und Wellenform-Animation, nur statische Pegelbalken.
