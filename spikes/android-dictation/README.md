# Spike: eigenständiges Android-Diktat

Stand: 20.11.2026

## Fragestellung

Kann Voice-Bridge auf einem Samsung Galaxy A54 als eigenständige App ein kleines
Diktat-Overlay über der vorhandenen Tastatur anzeigen, per Hardwaretaste
Push-to-Talk starten und das Ergebnis sicher in das ursprüngliche Textfeld
einfügen?

## Debug-Proof-of-Concept

Der isolierte Spike liegt in `android/app/src/debug/` und ist nicht Bestandteil
des Release-Manifests. Er enthält weder Audioaufnahme noch Netzwerkzugriff,
API-Schlüssel oder PC-Kopplung.

- Overlay: eigenes, berührbares `TYPE_APPLICATION_OVERLAY`, nicht fokussierbar;
  Android zeigt die nötige Systemfreigabe. Der Overlay-Tap ändert den Status,
  aber startet absichtlich keine Aufnahme.
- Hardwaretasten: ein ausdrücklich zu aktivierender Debug-
  `AccessibilityService` beobachtet Lauter/Leiser `KeyEvent`-Down/Up, liest
  keinen Fensterinhalt und gibt die Tastenereignisse unverändert weiter. Damit
  wird nur geprüft, ob Android diese Tasten auf diesem Gerät liefert – kein
  dauerhafter Aktivierungspfad zugesichert.
- Einfügen: ein Debug-IME wartet zwei Sekunden und fügt nur den festen
  Prüftext `Voice-Bridge-Probe` über `InputConnection.commitText()` ein. Bei
  geändertem oder fehlendem Editor wird abgebrochen; der Prüftext bleibt im
  Arbeitsspeicher und lässt sich aus dem Spike-Fenster kopieren. Erkannte
  Text-Passwortfelder werden gesperrt. Es wird kein Enter gesendet.
- Unit-Tests für die Editor-Sitzungswache liegen unter
  `android/app/src/testDebug/`.

### Ausführen auf dem Galaxy A54

1. `cd android; .\gradlew.bat installDebug`
2. `adb shell am start -n ch.voicebridge.app.spike/ch.voicebridge.app.AndroidDictationSpikeActivity`
3. Im Spike Overlay-Freigabe anfordern, danach das Overlay einblenden und in
   einem Textfeld prüfen, ob Bildschirmtastatur und Fokus erhalten bleiben.
4. Den Hardwaretasten-Testdienst in Android-Bedienungshilfen ausdrücklich
   aktivieren. Mit sichtbarem Overlay Lauter/Leiser drücken und loslassen;
   Statusanzeige beobachten und prüfen, dass die Lautstärke normal reagiert.
5. In Android-Tastatureinstellungen das Voice-Bridge-Test-IME aktivieren und
   über den Tastaturwähler auswählen. In einem normalen Textfeld Prüftext
   einsetzen lassen; separat während der 2-Sekunden-Wartezeit in ein anderes
   Feld wechseln und prüfen, dass nichts eingesetzt wird. Falls möglich auch
   ein Passwortfeld gegenprüfen.
6. Tatsächliche Ziel-Apps einzeln prüfen. Die IME-Probe beweist keine
   Universalunterstützung aller Editoren; Befunde und One-UI-Version hier
   ergänzen.

Der Debug-Build verwendet die Paket-ID `ch.voicebridge.app.spike`. Er kann
dadurch parallel zur vorhandenen, anders signierten Voice-Bridge-Installation
installiert werden, ohne diese zu ersetzen oder ihre PC-Kopplung anzutasten.

## Befund

- **Gerät erkannt:** `SM-A546B`, Android 16 / API 36,
  `ro.build.version.oneui=80500`; aktive Eingabemethode
  `com.samsung.android.honeyboard/.service.HoneyBoardService` (Samsung
  Keyboard). Diese Gerätewerte stammen aus ADB; Verhaltenstests sind noch
  auszuführen.
- **Verhalten nicht vorweggenommen:** Der Debug-Proof-of-Concept kann
  Overlay-, Tasten- und IME-Proben ausführen. Bis diese Schritte auf dem
  Gerät und in Ziel-Apps manuell beobachtet wurden, gelten sie als offen.
- **Hardwaretasten nicht als verlässlicher Auslöser zusicherbar:** Android
  bietet keinen allgemeinen App-Hook für beliebige Hardwaretasten im
  Hintergrund. Ein `AccessibilityService` kann nur nach ausdrücklicher
  Aktivierung durch den Nutzer laufen und muss Key-Event-Filterung anfordern;
  System- und Gerätefunktionen können Tasten trotzdem beanspruchen. Der
  Lautstärke-Tastenkürzel für Bedienungshilfen schaltet einen Dienst ein oder
  aus und ist kein gedrückthalten-bis-zum-loslassen-Auslöser. Die konkrete
  Samsung-Belegung ist zudem versions- und nutzerabhängig.
- **Overlay ist möglich, aber nicht bewiesen:** `TYPE_APPLICATION_OVERLAY`
  benötigt eine separate Freigabe «Über anderen Apps einblenden». Die
  Platzierung über der jeweiligen Bildschirmtastatur, Berührungsweitergabe,
  Systemfenster und One-UI-Verhalten müssen am Gerät geprüft werden. Es gibt
  keine Garantie, dass ein solches Fenster in jeder App gleich angezeigt
  wird.
- **Einfügen hat zwei unterschiedliche Wege:**
  - Ein `InputMethodService` kann Text über `InputConnection.commitText()`
    gezielt in den aktiven Editor schreiben. Das ist der vorgesehene
    Android-Eingabekanal, ersetzt aber während der Benutzung die ausgewählte
    Tastatur (z. B. Samsung Keyboard).
  - Ein Overlay über der bestehenden Tastatur benötigt für den
    app-übergreifenden Eingriff typischerweise einen
    Bedienungshilfen-Dienst. Er muss vom Nutzer in den Systemeinstellungen
    aktiviert werden; verfügbare Editieraktionen und Feldinformationen hängen
    von der jeweiligen App ab. `ACTION_SET_TEXT` ist nicht für jedes Feld
    verfügbar und liefert keine universelle Garantie für eine sichere
    Einfügung. Android beschreibt Bedienungshilfen-Dienste als Hilfen für
    Menschen mit Behinderungen; ihre Verwendung als allgemeiner App-Automations-
    kanal ist daher nicht vorauszusetzen und muss vor einer Veröffentlichung
    gesondert geprüft werden.
- **Sicherheitsgrenze:** Bei einem asynchronen Cloud-Aufruf kann Android keinen
  universellen, unveränderlichen Bezeichner für das ursprüngliche Textfeld
  garantieren. Vor dem Einfügen muss die App das Ziel erneut prüfen und bei
  unklarem oder gewechseltem Ziel abbrechen. Text bleibt dann im App-Zustand
  zum Kopieren erhalten; niemals an das neue Feld umleiten. Passwortfelder
  lassen sich anhand der verfügbaren Eingabemerkmale sperren, aber nicht in
  jeder fremden App zuverlässig erkennen.
- **Bestandscode:** `AudioCapture` liefert bereits 16-kHz-Mono-PCM im
  Arbeitsspeicher. `MainViewModel` startet die Aufnahme derzeit nur bei
  verbundener PC-App und sendet Audio an `BridgeClient`. Ein eigenständiger
  Android-Diktatpfad muss davon getrennt ergänzt werden; die vorhandene
  PC-Kopplung bleibt erhalten.

## Architekturfolgen und offene Wahl

1. Eigenständiges Diktat erhält einen separaten Android-Aufnahme-,
   Transkriptions- und Einfügepfad. Er ruft weder den PC-Bridge-Client noch
   Agent-Zustellung auf.
2. Der vereinbarte OpenAI-Direktzugriff verwendet den eigenen Schlüssel. Der
   Schlüssel soll mit AES-GCM und einem Android-Keystore-Schlüssel geschützt
   gespeichert, von Backups ausgeschlossen und nie protokolliert werden.
   Das schützt lokale Speicherung, macht einen in einer Client-App
   verwendeten API-Schlüssel aber nicht vor einem kompromittierten Gerät
   unextrahierbar.
3. Cloud-Upload erfolgt erst nach verständlicher Einwilligung für den
   jeweiligen Diktatablauf. Audio bleibt standardmässig im RAM; Inhaltslogs
   und automatisches Absenden gibt es nicht.
4. Vor der MVP-Implementierung muss feststehen, ob die App trotz der
   Einfügegrenzen als Overlay über der vorhandenen Tastatur weitergebaut wird,
   oder ob ein eigenes IME mit zuverlässigerem `InputConnection`-Pfad
   akzeptabel ist. Hardwaretasten sind für beide Wege bis zu einem
   erfolgreichen A54-Test nicht zugesichert.
5. Geräteabnahme bleibt erforderlich: Overlay über Samsung Keyboard und
   weiteren Tastaturen, Freigaben, Fokus-/App-Wechsel während der
   Transkription, Passwortfelder und Zielfelder in mehreren Apps testen.

## Quellen

- [Android: Accessibility services](https://developer.android.com/guide/topics/ui/accessibility/service)
- [Android: AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- [Android: Creating an input method](https://developer.android.com/develop/ui/views/touch-and-input/creating-input-method)
- [Android: InputConnection](https://developer.android.com/reference/android/view/inputmethod/InputConnection)
- [Android: WindowManager.LayoutParams](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY)
- Bestehender Projektkontext: ADR-013, ADR-014, ADR-021, Android-Design unter
  `.lavish/android-diktat-design.html`
