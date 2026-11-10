# Citrix – Testprotokoll und Einschränkungen

> Es gibt keine Funktionsgarantie für Citrix. Diese Datei hält fest, was geprüft wurde, mit welchem Ergebnis, und was nicht geht.

## Umgebung

| Feld | Wert |
|---|---|
| Datum | |
| Citrix Workspace App (Client) | |
| VDA-Version / Betriebssystem | |
| Desktop oder Published App | |
| Client-Betriebssystem | |
| Maus (Modell, Zusatztasten) | |
| Mikrofon / Headset | |

## Prüfungen

| # | Prüfung | Erwartung | Ergebnis | Notiz |
|---|---|---|---|---|
| C-01 | Voice-Bridge startet als portable `.exe` ohne Admin-Rechte | startet | | AppLocker? |
| C-02 | Hook sieht XButton1/2 Down/Up in der Session | Events kommen | | |
| C-03 | Hook kann XButton1/2 unterdrücken (Browser navigiert nicht) | unterdrückt | | |
| C-04 | Mausrad während Hold wird erkannt und unterdrückt | ja | | |
| C-05 | Tastatur-Hotkey als Alternative (z. B. F13, Ctrl+Alt+Space) | funktioniert | | Falls C-02 scheitert |
| C-06 | Mikrofon per HDX-Audio verfügbar, Pegel sichtbar | ja | | Policy? |
| C-07 | Audioqualität: Transkript vergleichbar mit lokal | ähnlich | | Codec |
| C-08 | Verbindung zu `api.openai.com` vom VDA | erreichbar | | Proxy, TLS-Inspection |
| C-09 | Overlay transparent und im Vordergrund in der Session | ja | | Grafikmodus |
| C-10 | Overlay stiehlt keinen Fokus | ja | | |
| C-11 | Einfügen per Zwischenablage + Ctrl+V in Notepad / Outlook / Browser | eingefügt | | |
| C-12 | Zwischenablage wird danach wiederhergestellt | ja | | Sync Client↔VDA |
| C-13 | `vb run -- copilot` im Terminal derselben Session, Named Pipe erreichbar | ja | | |
| C-14 | Zwei Profile parallel (privat lokal, Citrix in VDA) stören sich nicht | ja | | |
| C-15 | API-Key in safeStorage (DPAPI) im VDA speicherbar und nach Neuanmeldung lesbar | ja | | Roaming-Profil? |

## Bekannte Einschränkungen

_(nach dem Test ausfüllen)_

-
