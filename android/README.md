# Voice-Bridge für Android

Die Android-App hat zwei getrennte Wege: **Handy-Diktat** sendet nach einer
separaten Freigabe direkt an OpenAI; **PC-Mikrofon** behält die bisherige
gekoppelte WebSocket-Verbindung. Das Handy-Diktat benötigt Android 13 oder
neuer. Die PC-Kopplung bleibt separat verfügbar.

## Handy-Diktat einrichten

1. Öffne Voice-Bridge und füge unter **OpenAI-Schlüssel** deinen eigenen
   API-Schlüssel ein. Er wird mit AES-GCM und einem Android-Keystore-Schlüssel
   verschlüsselt; der gespeicherte Wert wird nie angezeigt und von Backups
   ausgeschlossen.
2. Erlaube Mikrofon, Benachrichtigungen und «Über anderen Apps einblenden».
   Aktiviere danach den Voice-Bridge-Bedienungshilfen-Dienst über die
   Android-Systemeinstellungen. Er liest keinen Feldinhalt und fordert keinen
   Zugriff auf Fensterinhalte an.
3. Schalte die verschiebbare Diktat-Pill ein. Eine dauerhafte
   Vordergrundbenachrichtigung zeigt an, dass das Overlay aktiv ist; die
   Mikrofonaufnahme beginnt erst nach deinem Tap.
4. Tippe auf die Pill, um die Aufnahme zu starten, und erneut, um sie zu
   beenden. Ein weiterer, ausdrücklich beschrifteter Tap auf **An OpenAI
   senden** gibt genau diese Aufnahme für die Transkription frei. Es werden
   weder Enter noch eine Sendeaktion ausgelöst.

Vor der Aufnahme wird das aktive Textfeld geprüft. Erkennbare Passwortfelder
und nicht unterstützte Editoren werden gesperrt. Vor dem Einfügen wird die
ursprüngliche Editor-Sitzung erneut geprüft; nach einem Feldwechsel bleibt der
Text in Voice-Bridge zum Kopieren erhalten und wird nicht umgeleitet.
Wechselt das Zielfeld schon während der Aufnahme, stoppt die Aufnahme; die
verfügbare Teilaufnahme wird nicht automatisch hochgeladen.
`commitText()` bestätigt nicht, dass die Ziel-App den Text tatsächlich
übernommen hat; das Feld muss kontrolliert werden. Die Aufnahme bleibt im RAM,
bis die Transkription erfolgreich war oder du sie verwirfst. Die maximale
Aufnahmezeit beträgt acht Minuten.

Das **Testlabor** nimmt eine Probe ohne Zielfeld auf. Auch dort gibt es keinen
Upload ohne den separaten Cloud-Test-Tap; ein Ergebnis wird nicht automatisch
eingefügt. Audio wird standardmässig nicht auf Disk gespeichert. Ein
Prozessabbruch kann nur im RAM gehaltene Daten verlieren.

## Plattformgrenzen

- Das sichere Einfügen über `InputMethod.AccessibilityInputConnection` ist ab
  Android 13 verfügbar und wurde auf dem Galaxy A54 mit Gmail und Samsung
  Keyboard geprüft. Andere Apps, Tastaturen und Eingabefelder können sich
  anders verhalten.
- Android liefert für `commitText()` keinen Erfolgswert. Voice-Bridge zeigt
  deshalb an, dass der Einfügeaufruf gesendet wurde, nicht dass die Ziel-App
  den Text garantiert angenommen hat.
- Der Mikrofon-Vordergrunddienst wird aus der sichtbaren App gestartet und
  bleibt aktiv, solange das Overlay läuft. Das erfüllt die
  Android-«while-in-use»-Voraussetzung für die Mikrofonberechtigung; Rechte,
  Akkuverwaltung und One UI müssen auf dem konkreten Gerät geprüft werden.
- Der Bedienungshilfen-Dienst ist optional und wird erst ab Android 13
  angeboten. Anforderungen des Google Play Stores für diesen Dienst sind vor
  einer Veröffentlichung separat zu prüfen.
- OpenAI verarbeitet Audio in der Cloud. Internetverbindung, ein gültiger
  API-Schlüssel und mögliche API-Kosten sind erforderlich. Schweizerdeutsch-
  Erkennung ist nicht garantiert; die aktuelle Transkription verwendet
  Deutsch als Spracheinstellung.

## PC-Mikrofon

Im **PC-Mikrofon**-Bereich bleibt die bestehende Kopplung per QR-Code erhalten.
Die App streamt dort weiter Audio an Voice-Bridge auf dem PC. Das Handy-Diktat
verwendet weder diese Verbindung noch PC-Profile oder Agent-Sessions.

## Entwicklung und Tests

```powershell
cd android
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Für den Geräte-Test `.\gradlew.bat installDebug` ausführen und die
Einrichtungsschritte in der App durchgehen. Die Debug-Variante verwendet wie
bisher die separate Paket-ID `ch.voicebridge.app.spike`; der Release-Build
verwendet `ch.voicebridge.app`.
