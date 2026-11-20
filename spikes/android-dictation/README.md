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
  Android zeigt die nötige Systemfreigabe. Der Tap fordert im PoC nur das
  Einfügen eines festen Prüftexts an, keine Aufnahme. Ziehen verschiebt die
  Pill; kurzes Tippen löst den Einfügetest aus. Die Position bleibt beim
  Aus-/Einblenden während der laufenden PoC-Aktivität erhalten.
- Hardwaretasten: ein ausdrücklich zu aktivierender Debug-
  `AccessibilityService` beobachtet Lauter/Leiser `KeyEvent`-Down/Up, liest
  keinen Fensterinhalt und gibt die Tasten weiter. Der Debug-Dienst verändert
  keine Lautstärke und ist kein produktiver Hotkey.
- Overlay-Einfügen: derselbe Debug-Dienst fordert auf Android 13+ die
  `FLAG_INPUT_METHOD_EDITOR`-Funktion an und nutzt
  `InputMethod.AccessibilityInputConnection.commitText()` für einen festen
  Prüftext. Der Dienst fragt keine Fensterinhalte ab (`canRetrieveWindowContent`
  bleibt aus) und liest nie den vorhandenen Feldtext. Er prüft die vom System
  gelieferte Editor-Sitzung und sperrt erkannte Passwortfelder. Das Verfahren
  liefert keinen Erfolgswert; der Prüftext bleibt daher vorsichtshalber im
  Spike-Fenster erhalten und das Ergebnis muss im Zielfeld kontrolliert werden.
  Der A54-Test bestätigt Einfügen in Gmail, nicht jedoch Universalunterstützung;
  Android, One UI und Ziel-App bleiben Kompatibilitätsgrenzen.
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
3. Im Spike Overlay-Freigabe anfordern, den Bedienungshilfen-Dienst
   aktivieren und das Overlay einblenden. Danach z. B. Gmail mit Samsung
   Keyboard öffnen, die Pill an eine andere Bildschirmposition ziehen und in
   einem normalen Textfeld auf «Voice-Bridge-Test · Prüftext» tippen; nach zwei
   Sekunden sollte der feste Prüftext am Cursor erscheinen, ohne dass Enter
   oder Senden ausgelöst wird. Der Spike kann den Erfolg nicht selbst
   feststellen; Prüftext und Status bleiben deshalb im Spike-Fenster erhalten.
   Während der Wartezeit in ein anderes Feld wechseln und prüfen, dass nichts
   eingesetzt wird. Passwortfelder und Gmail/weitere Ziel-Apps separat prüfen.
4. Mit aktiviertem Bedienungshilfen-Dienst Lauter/Leiser drücken und
   loslassen. Die Ereignisse erscheinen im Status; die Tasten werden
   weitergereicht und die Lautstärke bleibt bedienbar.
5. Als getrennten Vergleich in Android-Tastatureinstellungen das
   Voice-Bridge-Test-IME aktivieren und
   über den Tastaturwähler auswählen. In einem normalen Textfeld Prüftext
   einsetzen lassen; separat während der 2-Sekunden-Wartezeit in ein anderes
   Feld wechseln und prüfen, dass nichts eingesetzt wird. Falls möglich auch
   ein Passwortfeld gegenprüfen.
6. Tatsächliche Ziel-Apps einzeln prüfen. Weder Overlay- noch IME-Probe
   beweist Universalunterstützung aller Editoren; Befunde und One-UI-Version
   hier ergänzen.

Der Debug-Build verwendet die Paket-ID `ch.voicebridge.app.spike`. Er kann
dadurch parallel zur vorhandenen, anders signierten Voice-Bridge-Installation
installiert werden, ohne diese zu ersetzen oder ihre PC-Kopplung anzutasten.

## Befund

- **Gerät erkannt:** `SM-A546B`, Android 16 / API 36,
  `ro.build.version.oneui=80500`; aktive Eingabemethode
  `com.samsung.android.honeyboard/.service.HoneyBoardService` (Samsung
  Keyboard). Diese Gerätewerte stammen aus ADB.
- **Debug-Proof-of-Concept installiert und gestartet:** `testDebugUnitTest`,
  `assembleDebug` und `lintDebug` sind erfolgreich; der Debug-Build ist unter
  der separaten Paket-ID `ch.voicebridge.app.spike` auf dem Gerät installiert
  und `AndroidDictationSpikeActivity` ist nach dem Start auf dem A54 aktiv. Ein
  Android-16-Zugriffsschutz für `Settings.Secure.ENABLED_INPUT_METHODS` wurde
  durch `InputMethodManager.enabledInputMethodList` ersetzt. Die Installation
  hat die bestehende Paket-ID und PC-Kopplung nicht ersetzt.
- **A54-Verhalten, manuell vom Nutzer geprüft:**
  - Das schwebende Overlay wird angezeigt.
  - Das Overlay bleibt beim Wechsel zu Gmail sichtbar; Samsung Keyboard bleibt
    als Eingabemethode aktiv.
  - Die Pill lässt sich mit dem Finger verschieben und bleibt an der
    Zielposition; Ziehen löst kein Einfügen aus. Kurzes Tippen nach dem
    Verschieben löst den Einfügetest weiter aus.
  - Der Overlay-Einfügepfad setzt den Prüftext in den Gmail-Nachrichtentext.
    Beim Wechsel vom Nachrichtentext zum Betreff während der Wartezeit wird
    nicht in das neue Feld eingefügt.
  - In einem Chrome-Login-Passwortfeld wurde nicht eingefügt; der Spike zeigte
    «Passwortfeld erkannt · Einfügen gesperrt».
  - Ein temporärer Debug-PTT-Modus zeigte auf A54 beide Lautstärketasten als
    PTT-Status beim Halten und stoppte beim Loslassen; dafür wurden die Tasten
    abgefangen. Der Nutzer entschied sich gegen diese Bedienung, damit die
    Lautstärke bedienbar bleibt. Der aktuelle PoC reicht die Ereignisse weiter.
  - Das Debug-IME fügt seinen festen Prüftext in Gmail ein.
  - Beim Wechsel vom ursprünglichen Gmail-Feld zum Betreff vor dem nächsten
    verzögerten Einfügen erfolgte laut Nutzer kein Einfügen in das neue Feld.
- **Noch offen:** Ob eine andere Hardwaretaste systemweit als Aktivierung
  geeignet ist. Der MVP verwendet gemäss Entscheid die bewegliche Overlay-Pill
  statt Lautstärketasten-PTT. Der Einfügepfad ist erst in Gmail und Chrome
  getestet; andere Apps und Editor-Typen bleiben offen.
- **Hardwaretasten sind geräteabhängig:** Auf dem A54 kann der aktivierte
  `AccessibilityService` beide Lautstärketasten abfangen und Down/Up als
  gedrückt/losgelassen auswerten. Der Nutzer entschied sich gegen diesen Weg,
  weil dabei die Lautstärke nicht bedienbar ist. Der MVP nutzt Overlay-Tap;
  Android bietet keinen allgemeinen Hook für beliebige Hardwaretasten.
- **Overlay ist für die getesteten Apps bewiesen, nicht universell:** Der
  A54-Nutzer hat die Anzeige über Samsung Keyboard und den Wechsel zu Gmail
  bestätigt. `TYPE_APPLICATION_OVERLAY` benötigt eine separate Freigabe
  «Über anderen Apps einblenden». Andere Tastaturen, Apps, Systemfenster und
  One-UI-Zustände bleiben zu prüfen; gleiches Verhalten in jeder App ist nicht
  garantiert.
- **Einfügen hat zwei unterschiedliche Wege:**
  - Ein `InputMethodService` kann Text über `InputConnection.commitText()`
    gezielt in den aktiven Editor schreiben. Das ist der vorgesehene
    Android-Eingabekanal, ersetzt aber während der Benutzung die ausgewählte
    Tastatur (z. B. Samsung Keyboard).
  - Ein Overlay über der bestehenden Tastatur benötigt für den
    app-übergreifenden Eingriff einen vom Nutzer aktivierten Dienst. Ab Android
    13 stellt `AccessibilityService` mit `FLAG_INPUT_METHOD_EDITOR` und
    `InputMethod.AccessibilityInputConnection` einen gezielten Schreibkanal
    bereit. Der Spike fordert keinen Zugriff auf Fensterinhalte an und liest
    keinen Feldtext. Der A54-Test bestätigt die Einfügung über Samsung Keyboard
    in Gmail und den Abbruch beim Feldwechsel. Android beschreibt
    Bedienungshilfen-Dienste als Hilfen für Menschen mit Behinderungen; ihre
    Verwendung als allgemeiner App-Automationskanal ist daher nicht
    vorauszusetzen und muss vor einer Veröffentlichung gesondert geprüft werden.
- **Sicherheitsgrenze:** Bei einem asynchronen Cloud-Aufruf kann Android keinen
  universellen, unveränderlichen Bezeichner für das ursprüngliche Textfeld
  garantieren. Vor dem Einfügen muss die App das Ziel erneut prüfen und bei
  unklarem oder gewechseltem Ziel abbrechen. Text bleibt dann im App-Zustand
  zum Kopieren erhalten; niemals an das neue Feld umleiten. Passwortfelder
  liessen sich anhand der verfügbaren Eingabemerkmale in Chromes Login-Formular
  erkennen und sperren; das ist keine Garantie für jede fremde App.
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
4. Der A54-Test belegt Overlay-Einfügen per `AccessibilityInputConnection`
   mindestens in Gmail; der Overlay-Weg erhält Samsung Keyboard. Vor dem MVP
   bleibt zu entscheiden, ob die Aktivierung per Overlay-Tap genügt oder ob
   weitere Hardwaretasten-Aktivierung erwartet wird. Letztere ist nicht
   zuverlässig zusicherbar.
5. Vor Veröffentlichung sind Android-/Store-Anforderungen für den
   Bedienungshilfen-Dienst sowie weitere Ziel-Apps, Tastaturen und Felder zu
   prüfen.

## Quellen

- [Android: Accessibility services](https://developer.android.com/guide/topics/ui/accessibility/service)
- [Android: AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService)
- [Android: Creating an input method](https://developer.android.com/develop/ui/views/touch-and-input/creating-input-method)
- [Android: InputConnection](https://developer.android.com/reference/android/view/inputmethod/InputConnection)
- [Android: AccessibilityService InputMethod](https://developer.android.com/reference/android/accessibilityservice/InputMethod)
- [Android: WindowManager.LayoutParams](https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY)
- Bestehender Projektkontext: ADR-013, ADR-014, ADR-021, Android-Design unter
  `.lavish/android-diktat-design.html`
