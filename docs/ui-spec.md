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
| Einstellungen | 1100 × 760, skalierbar | zentriert | normales Fenster | normal |

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

### Fehler (Mockup 3a)

Jeder Fehler zeigt den Text bzw. die Aufnahme und bietet mindestens **Kopieren** und **Verwerfen**. Der Dialog bleibt, bis der Nutzer handelt. Er schliesst nicht automatisch.

| Fehler | Primäraktion | Weitere Aktionen |
|---|---|---|
| Session weg | Andere Session wählen | Kopieren, Verwerfen |
| STT fehlgeschlagen | Erneut versuchen | Abspielen, Verwerfen |
| Kein Textfeld | OK (Text liegt in der Zwischenablage) | Verlauf öffnen |
| Senden fehlgeschlagen (I/O) | Erneut senden | Kopieren, Verwerfen |

### Tray (Mockup 3b)

- Icon-Zustände: bereit (grau), Diktat-Aufnahme (Mint + roter Punkt), Agent-Aufnahme (Amber + roter Punkt), pausiert (durchgestrichen), Fehler (rot).
- Profilwechsel startet die andere Profil-Instanz bzw. holt sie in den Vordergrund. Eine Instanz wechselt nie das eigene Profil im Betrieb.

## Barrierefreiheit

- Overlays mit `role="status"` bzw. `role="alertdialog"`, Popup als `listbox`.
- Kontrast ≥ 4.5:1 auch für 11-px-Labels.
- `prefers-reduced-motion`: keine Puls- und Wellenform-Animation, nur statische Pegelbalken.
