package ch.voicebridge.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.voicebridge.app.Connection
import ch.voicebridge.app.R
import ch.voicebridge.app.Outcome
import ch.voicebridge.app.PairingRepository
import ch.voicebridge.app.Target
import ch.voicebridge.app.UiState
import kotlinx.coroutines.delay

@Composable
fun PairingScreen(error: String?, connecting: Boolean, onScan: () -> Unit, onLink: (String) -> Unit) {
    var link by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().background(VB.Ink).safeDrawingPadding().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        Text("VOICE-BRIDGE", color = VB.Lime, fontSize = 12.sp, letterSpacing = 1.2.sp, fontFamily = FontFamily.Monospace)
        Text("Dein Handy ist das Mikrofon.", color = VB.Text, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold, lineHeight = 34.sp, letterSpacing = (-0.5).sp)
        Text(
            "Auf dem PC in Voice-Bridge unter Einstellungen → Handy «Verbindungen erlauben» einschalten " +
                "und den QR-Code anzeigen lassen. Handy und PC müssen im selben WLAN sein.",
            color = VB.Text2,
        )
        Button(onClick = onScan, enabled = !connecting, modifier = Modifier.fillMaxWidth().height(52.dp)) {
            Text(if (connecting) "Verbinde …" else "QR-Code scannen", fontWeight = FontWeight.SemiBold)
        }
        if (error != null) Text(error, color = VB.Rec)
        Spacer(Modifier.height(8.dp))
        Text("Oder Kopplungslink einfügen", color = VB.Text3, fontSize = 13.sp)
        OutlinedTextField(
            value = link,
            onValueChange = { link = it },
            placeholder = { Text("voicebridge://pair?…") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedButton(onClick = { onLink(link) }, enabled = link.isNotBlank() && !connecting) { Text("Koppeln") }
    }
}

@Composable
fun MainScreen(
    state: UiState,
    onSelect: (String) -> Unit,
    onPress: () -> Boolean,
    onRelease: () -> Unit,
    onReconnect: () -> Unit,
    onUnpair: () -> Unit,
    onDismiss: () -> Unit,
) {
    val connected = state.connection as? Connection.Connected
    Column(Modifier.fillMaxSize().background(VB.Ink).safeDrawingPadding().padding(horizontal = 20.dp)) {
        Header(state.connection, onReconnect, onUnpair)
        Text(
            "ZIEL WÄHLEN",
            color = VB.Text3,
            fontSize = 11.sp,
            letterSpacing = 1.sp,
            modifier = Modifier.padding(top = 12.dp, bottom = 8.dp),
        )
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            item {
                TargetRow("Am Cursor einfügen", "Diktat ins aktive Fenster", state.selected == PairingRepository.CURSOR, VB.Teal) {
                    onSelect(PairingRepository.CURSOR)
                }
            }
            items(state.targets, key = Target::id) { t ->
                TargetRow(
                    t.name,
                    t.title ?: if (t.state == "busy") "arbeitet …" else "wartet",
                    state.selected == t.id,
                    if (t.state == "busy") VB.Lime else VB.Teal,
                    mono = true,
                ) { onSelect(t.id) }
            }
            if (state.targets.isEmpty() && connected != null) {
                item {
                    Text(
                        "Keine Agent-Sessions. Auf dem PC mit «vb run -- copilot» starten.",
                        color = VB.Text3,
                        fontSize = 13.sp,
                        modifier = Modifier.padding(8.dp),
                    )
                }
            }
        }
        OutcomeCard(state.outcome, onDismiss)
        PushToTalk(
            enabled = connected != null,
            agent = state.selected != PairingRepository.CURSOR,
            recording = state.recording.active,
            startedAt = state.recording.startedAt,
            levels = state.recording.levels,
            onPress = onPress,
            onRelease = onRelease,
        )
    }
}

@Composable
private fun Header(connection: Connection, onReconnect: () -> Unit, onUnpair: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        val (dot, label) = when (connection) {
            is Connection.Connected -> VB.Teal to "verbunden · Profil ${connection.profile}"
            Connection.Connecting -> VB.Lime to "verbinde …"
            is Connection.Offline -> VB.Rec to connection.reason
            Connection.Unpaired -> VB.Rec to "nicht gekoppelt"
        }
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
                Spacer(Modifier.width(8.dp))
                Text(label, color = VB.Text2, fontSize = 13.sp, maxLines = 2)
            }
            Text(
                (connection as? Connection.Connected)?.pc ?: "Voice-Bridge",
                color = VB.Text,
                fontSize = 22.sp,
                fontWeight = FontWeight.SemiBold,
            )
        }
        if (connection is Connection.Offline) TextButton(onClick = onReconnect) { Text("Erneut") }
        TextButton(onClick = onUnpair) { Text("Entkoppeln", color = VB.Text3) }
    }
}

@Composable
private fun TargetRow(title: String, subtitle: String, selected: Boolean, dot: Color, mono: Boolean = false, onClick: () -> Unit) {
    val shape = RoundedCornerShape(10.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) VB.Lime.copy(alpha = 0.14f) else VB.Ink3)
            .then(if (selected) Modifier.border(1.dp, VB.Lime.copy(alpha = 0.6f), shape) else Modifier)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(dot))
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = VB.Text, fontFamily = if (mono) FontFamily.Monospace else FontFamily.Default, fontSize = 14.sp)
            Text(subtitle, color = VB.Text3, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (selected) {
            Text(
                "ZIEL",
                color = VB.OnAccent,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(VB.Lime).padding(horizontal = 7.dp, vertical = 2.dp),
            )
        }
    }
}

@Composable
private fun OutcomeCard(outcome: Outcome?, onDismiss: () -> Unit) {
    if (outcome == null) return
    val clipboard = LocalClipboardManager.current
    val (color, title, body) = when (outcome) {
        is Outcome.Working -> Triple(VB.Text2, outcome.label, null)
        is Outcome.Sent -> Triple(VB.Teal, if (outcome.target != null) "Gesendet an ${outcome.target}" else "Eingefügt", outcome.text)
        is Outcome.Failed -> Triple(VB.Rec, outcome.message, outcome.text)
    }
    Column(
        Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(14.dp)).background(VB.Ink2).padding(14.dp),
    ) {
        Text(title, color = color, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
        if (body != null) {
            Text("«$body»", color = VB.Text, fontSize = 13.sp, maxLines = 4, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            Row {
                TextButton(onClick = { clipboard.setText(AnnotatedString(body)) }) { Text("Kopieren") }
                if (outcome is Outcome.Failed) TextButton(onClick = onDismiss) { Text("Schliessen") }
            }
        }
    }
}

@Composable
private fun PushToTalk(
    enabled: Boolean,
    agent: Boolean,
    recording: Boolean,
    startedAt: Long,
    levels: List<Float>,
    onPress: () -> Boolean,
    onRelease: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val accent = if (agent) VB.Lime else VB.Teal
    val scale by animateFloatAsState(if (recording) 1.06f else 1f, label = "ptt")
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(recording) {
        while (recording) {
            now = System.currentTimeMillis()
            delay(250)
        }
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.height(40.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            levels.forEach { l ->
                Box(Modifier.width(4.dp).height((6 + l * 34).dp).clip(RoundedCornerShape(2.dp)).background(if (recording) accent else VB.Line))
            }
        }
        Spacer(Modifier.height(12.dp))
        Box(
            Modifier
                .size(168.dp)
                .scale(scale)
                .clip(CircleShape)
                .background(if (enabled) accent else VB.Ink3)
                .semantics { contentDescription = "Halten zum Sprechen" }
                .pointerInput(enabled) {
                    if (!enabled) return@pointerInput
                    detectTapGestures(onPress = {
                        if (onPress()) {
                            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                            tryAwaitRelease()
                            onRelease()
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                        }
                    })
                },
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painterResource(R.drawable.ic_mic),
                contentDescription = null,
                tint = if (recording) VB.Rec else VB.OnAccent,
                modifier = Modifier.size(56.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        val seconds = ((now - startedAt) / 1000).coerceAtLeast(0)
        Text(
            when {
                !enabled -> "Nicht verbunden"
                recording -> "Loslassen zum Senden · %d:%02d".format(seconds / 60, seconds % 60)
                agent -> "Halten zum Sprechen · Prompt an Session"
                else -> "Halten zum Sprechen · Text am Cursor"
            },
            color = VB.Text2,
            fontSize = 13.sp,
        )
    }
}

@Composable
fun PermissionHint(onRequest: () -> Unit) {
    Column(Modifier.fillMaxSize().background(VB.Ink).padding(24.dp), verticalArrangement = Arrangement.Center) {
        Text("Mikrofon erlauben", color = VB.Text, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "Voice-Bridge nimmt nur auf, solange du den Knopf hältst. Der Ton geht verschlüsselt an deinen PC und wird nicht gespeichert.",
            color = VB.Text2,
            modifier = Modifier.padding(vertical = 12.dp),
        )
        Button(onClick = onRequest, colors = ButtonDefaults.buttonColors()) { Text("Erlauben") }
    }
}
