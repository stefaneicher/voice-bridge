package ch.voicebridge.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalClipboardManager
import ch.voicebridge.app.DictationPhase
import ch.voicebridge.app.DictationUiState

@Composable
fun DictationScreen(
    state: DictationUiState,
    supported: Boolean,
    microphoneGranted: Boolean,
    overlayPermission: Boolean,
    accessibilityEnabled: Boolean,
    notificationsGranted: Boolean,
    apiKeyStored: Boolean,
    setupError: String?,
    onSaveApiKey: (String) -> Unit,
    onDeleteApiKey: () -> Unit,
    onOpenApiKeyPage: () -> Unit,
    onRequestMicrophone: () -> Unit,
    onRequestOverlay: () -> Unit,
    onRequestAccessibility: () -> Unit,
    onRequestNotifications: () -> Unit,
    onEnableOverlay: () -> Unit,
    onDisableOverlay: () -> Unit,
    onStartTest: () -> Unit,
    onStopRecording: () -> Unit,
    onSendAudio: () -> Unit,
    onDiscard: () -> Unit,
    onOpenPcMode: () -> Unit,
) {
    var apiKey by remember { mutableStateOf("") }
    val clipboard = LocalClipboardManager.current
    val prerequisites = supported && microphoneGranted && overlayPermission &&
        accessibilityEnabled && notificationsGranted && apiKeyStored

    Column(
        Modifier.fillMaxSize().background(VB.Ink).verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                Text("VOICE-BRIDGE", color = VB.Teal, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text("Handy-Diktat", color = VB.Text, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            }
            TextButton(onClick = onOpenPcMode) { Text("PC-Mikrofon") }
        }
        Text(
            "Eigenständiges Diktat direkt am Handy. Die PC-Kopplung bleibt separat verfügbar.",
            color = VB.Text2,
        )

        SectionCard("Einrichtung") {
            if (!supported) {
                StatusLine(false, "Automatisches Einfügen benötigt Android 13 oder neuer.")
            } else {
                StatusLine(microphoneGranted, "Mikrofon")
                if (!microphoneGranted) OutlinedButton(onClick = onRequestMicrophone) { Text("Mikrofon erlauben") }
                StatusLine(overlayPermission, "Schwebendes Overlay")
                if (!overlayPermission) OutlinedButton(onClick = onRequestOverlay) { Text("Overlay erlauben") }
                StatusLine(accessibilityEnabled, "Sicheres Einfügen und Tastatur erkennen")
                if (!accessibilityEnabled) OutlinedButton(onClick = onRequestAccessibility) { Text("Bedienungshilfe aktivieren") }
                Text(
                    "Für das automatische Einblenden der Pill erkennt Voice-Bridge nur, ob ein Tastaturfenster geöffnet ist. Android verlangt dafür die allgemeine Fähigkeit zum Abruf von Fensterinhalten. Voice-Bridge liest weder Fensterstruktur noch Text aus anderen Apps; bei Unsicherheit bleibt die Pill verborgen.",
                    color = VB.Text2,
                )
                StatusLine(notificationsGranted, "Aufnahmebenachrichtigung")
                if (!notificationsGranted) OutlinedButton(onClick = onRequestNotifications) { Text("Benachrichtigungen erlauben") }
            }
            Spacer(Modifier.height(2.dp))
            if (state.overlayEnabled) {
                Text("Diktat-Pill aktiv · erscheint mit der Tastatur. Aufnahme startet nur nach Antippen.", color = VB.Teal)
                OutlinedButton(
                    onClick = onDisableOverlay,
                    enabled = state.phase != DictationPhase.RECORDING &&
                        state.phase != DictationPhase.TRANSCRIBING &&
                        !state.audioAvailable && state.text == null,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Overlay ausschalten") }
            } else {
                Button(
                    onClick = onEnableOverlay,
                    enabled = prerequisites && state.phase != DictationPhase.RECORDING,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Verschiebbare Diktat-Pill einschalten") }
            }
        }

        SectionCard("OpenAI-Schlüssel") {
            Text(
                if (apiKeyStored) "Schlüssel verschlüsselt hinterlegt · Wert wird nicht angezeigt."
                else "Eigenen OpenAI-API-Schlüssel eingeben. Ein ChatGPT-Abonnement ersetzt keinen API-Zugang.",
                color = VB.Text2,
                fontSize = 13.sp,
            )
            TextButton(onClick = onOpenApiKeyPage) {
                Text("API-Schlüssel bei OpenAI erstellen")
            }
            OutlinedTextField(
                value = apiKey,
                onValueChange = { apiKey = it },
                label = { Text(if (apiKeyStored) "Neuen Schlüssel eingeben" else "API-Schlüssel") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { onSaveApiKey(apiKey); apiKey = "" },
                enabled = apiKey.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(if (apiKeyStored) "Schlüssel ersetzen" else "Schlüssel geschützt speichern") }
            if (apiKeyStored || setupError != null) {
                TextButton(onClick = onDeleteApiKey) { Text("Schlüssel löschen oder zurücksetzen", color = VB.Text3) }
            }
            if (setupError != null) Text(setupError, color = VB.Rec, fontSize = 13.sp)
        }

        SectionCard("Cloud und Datenschutz") {
            Text(
                "Jede Aufnahme bleibt zunächst im Arbeitsspeicher. Erst der separate Knopf «An OpenAI senden» gibt genau diese Aufnahme frei. Dabei werden Audio und Spracheinstellung Deutsch über HTTPS an OpenAI gesendet; API-Kosten können entstehen. Nach erfolgreicher Transkription wird Audio verworfen. Bei Fehlern bleibt verfügbare Aufnahme oder Text bis zu deiner Entscheidung erhalten.",
                color = VB.Text2,
                fontSize = 13.sp,
            )
            Text(
                "Voice-Bridge liest keinen Feldinhalt, zeichnet nichts standardmässig auf Disk auf und sendet weder Enter noch eine Nachricht. Erkennbar markierte Passwortfelder werden gesperrt.",
                color = VB.Text3,
                fontSize = 12.sp,
            )
        }

        if (state.phase != DictationPhase.DISABLED &&
            state.phase != DictationPhase.READY &&
            !state.testLab
        ) {
            SectionCard("Diktat") {
                DictationActivityContent(
                    state = state,
                    onStopRecording = onStopRecording,
                    onSendAudio = onSendAudio,
                    onDiscard = onDiscard,
                )
            }
        }

        SectionCard("Testlabor") {
            Text("Nimm eine kurze Probe auf. Sie wird erst nach «Cloud-Test senden» an OpenAI übermittelt und nie automatisch in ein Feld eingefügt.", color = VB.Text2, fontSize = 13.sp)
            when {
                !state.overlayEnabled -> Text("Schalte zuerst die Diktat-Pill ein.", color = VB.Text3)
                state.phase == DictationPhase.READY -> Button(
                    onClick = onStartTest,
                    enabled = apiKeyStored,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("Testaufnahme starten") }
            }
            if (state.testLab) {
                DictationActivityContent(
                    state = state,
                    onStopRecording = onStopRecording,
                    onSendAudio = onSendAudio,
                    onDiscard = onDiscard,
                )
            }
        }

        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun DictationActivityContent(
    state: DictationUiState,
    onStopRecording: () -> Unit,
    onSendAudio: () -> Unit,
    onDiscard: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    Text(state.message, color = if (state.phase == DictationPhase.ERROR) VB.Rec else VB.Text2, fontSize = 13.sp)
    if (state.phase == DictationPhase.RECORDING) {
        Button(onClick = onStopRecording, modifier = Modifier.fillMaxWidth()) { Text("Aufnahme stoppen") }
    }
    if (state.phase == DictationPhase.AWAITING_CONSENT) {
        Button(onClick = onSendAudio, modifier = Modifier.fillMaxWidth()) {
            Text(if (state.testLab) "Cloud-Test an OpenAI senden" else "Aufnahme an OpenAI senden")
        }
        TextButton(onClick = onDiscard) { Text("Aufnahme verwerfen", color = VB.Text3) }
    }
    if (state.phase == DictationPhase.ERROR && state.audioAvailable) {
        Button(onClick = onSendAudio, modifier = Modifier.fillMaxWidth()) { Text("Erneut an OpenAI senden") }
        TextButton(onClick = onDiscard) { Text("Aufnahme verwerfen", color = VB.Text3) }
    }
    if (state.phase == DictationPhase.TRANSCRIBING) CircularProgressIndicator()
    state.text?.let { text ->
        Text("Ergebnis", color = VB.Text, fontWeight = FontWeight.SemiBold)
        Text(text, color = VB.Text, modifier = Modifier.padding(vertical = 4.dp))
        TextButton(onClick = { clipboard.setText(AnnotatedString(text)) }) { Text("Text kopieren") }
        TextButton(onClick = onDiscard) { Text("Ergebnis schliessen", color = VB.Text3) }
    }
    if ((state.phase == DictationPhase.ERROR || state.phase == DictationPhase.RESULT) &&
        !state.audioAvailable &&
        state.text == null
    ) {
        TextButton(onClick = onDiscard) {
            Text(if (state.phase == DictationPhase.ERROR) "Meldung schliessen" else "Ergebnis schliessen", color = VB.Text3)
        }
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = VB.Ink2),
        shape = RoundedCornerShape(16.dp),
    ) {
        Column(
            Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Text(title, color = VB.Text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            content()
        }
    }
}

@Composable
private fun StatusLine(ready: Boolean, label: String) {
    Text("${if (ready) "✓" else "○"}  $label", color = if (ready) VB.Teal else VB.Text2, fontSize = 13.sp)
}
