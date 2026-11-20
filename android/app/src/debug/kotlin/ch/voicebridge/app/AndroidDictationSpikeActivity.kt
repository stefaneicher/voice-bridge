package ch.voicebridge.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.TextUtils
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import ch.voicebridge.app.ui.VB
import ch.voicebridge.app.ui.VoiceBridgeTheme
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

class AndroidDictationSpikeActivity : ComponentActivity() {
    private var resumedTick by mutableIntStateOf(0)
    private var overlayShown by mutableStateOf(false)
    private var overlayView: TextView? = null
    private var overlayStatusJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            VoiceBridgeTheme {
                val state by SpikeProofState.state.collectAsState()
                val tick = resumedTick
                val overlayAllowed = remember(tick) { Settings.canDrawOverlays(this) }
                val accessibilityEnabled = remember(tick) { isServiceEnabled(HardwareKeySpikeService::class.java) }
                val imeEnabled = remember(tick) { isInputMethodEnabled() }
                val clipboard = LocalClipboardManager.current
                var sampleText by remember { mutableStateOf("") }

                Column(
                    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Text("ANDROID-DIKTAT · PROOF OF CONCEPT", color = VB.Lime)
                    Text("Nur Techniktest – keine Aufnahme und kein Cloud-Aufruf.", color = VB.Text2)
                    Text("Berechtigungen", color = VB.Text)
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = ::openOverlaySettings, modifier = Modifier.fillMaxWidth()) {
                            Text(if (overlayAllowed) "Overlay erlaubt" else "Overlay erlauben")
                        }
                        OutlinedButton(onClick = ::openAccessibilitySettings, modifier = Modifier.fillMaxWidth()) {
                            Text(if (accessibilityEnabled) "Tasten-Test bereit" else "Tasten-Test einrichten")
                        }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = ::openInputMethodSettings, modifier = Modifier.fillMaxWidth()) {
                            Text(if (imeEnabled) "Tastatur aktiviert" else "IME aktivieren")
                        }
                        OutlinedButton(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                if (imeEnabled) {
                                    (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                                        .showInputMethodPicker()
                                } else {
                                    openInputMethodSettings()
                                }
                            },
                        ) {
                            Text("Voice-Bridge wählen")
                        }
                    }

                    Button(
                        onClick = ::toggleOverlay,
                        enabled = overlayAllowed,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(if (overlayShown) "Overlay ausblenden" else "Overlay einblenden")
                    }
                    Text("Hardwaretaste", color = VB.Text)
                    Text(state.hardwareKeyStatus, color = VB.Text2)
                    Text(
                        "Mit aktiviertem Testdienst Lauter oder Leiser kurz drücken und halten. " +
                            "Der Test beobachtet Key-down/up, verbraucht das Ereignis nicht und verändert keine Lautstärke.",
                        color = VB.Text3,
                    )

                    Spacer(Modifier.height(6.dp))
                    Text("Einfügetest mit Voice-Bridge-IME", color = VB.Text)
                    OutlinedTextField(
                        value = sampleText,
                        onValueChange = { sampleText = it },
                        placeholder = { Text("Oder in einer anderen App testen") },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        "Aktiviere und wähle das IME. Seine Schaltfläche wartet 2 Sekunden, " +
                            "prüft dieselbe Editor-Sitzung und fügt nur den Prüftext ein. " +
                            "Währenddessen zu einem anderen Feld wechseln, um den Abbruch zu prüfen.",
                        color = VB.Text3,
                    )
                    Text(state.insertionStatus, color = VB.Text2)
                    state.pendingText?.let { text ->
                        Text("Erhaltener Prüftext: «$text»", color = VB.Lime)
                        OutlinedButton(onClick = { clipboard.setText(AnnotatedString(text)) }) {
                            Text("Prüftext kopieren")
                        }
                    }
                    Text(
                        "Keine Audioaufnahme, API-Schlüssel, Netzwerkzugriffe, App-Inhaltslesung oder Inhaltslogs. " +
                            "Der Spike ist nur im Debug-Build enthalten.",
                        color = VB.Text3,
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        resumedTick += 1
    }

    override fun onDestroy() {
        hideOverlay()
        super.onDestroy()
    }

    private fun openOverlaySettings() {
        startActivity(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName"),
            ),
        )
    }

    private fun openAccessibilitySettings() {
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private fun openInputMethodSettings() {
        startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS))
    }

    private fun toggleOverlay() {
        if (overlayView != null) {
            hideOverlay()
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            openOverlaySettings()
            return
        }

        val view = TextView(this).apply {
            text = "●  Voice-Bridge-Test · Tippen"
            textSize = 14f
            setTextColor(0xFFEDF6F3.toInt())
            setPadding(dp(18), dp(12), dp(18), dp(12))
            maxWidth = resources.displayMetrics.widthPixels - dp(32)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            background = GradientDrawable().apply {
                setColor(0xFF15151C.toInt())
                setStroke(dp(1), 0xFF2AA5A1.toInt())
                cornerRadius = dp(28).toFloat()
            }
            isFocusable = false
            isFocusableInTouchMode = false
            setOnClickListener {
                SpikeProofState.reportHardwareKey("Overlay-Tap erkannt · Fokus wird nicht angefordert")
            }
        }
        val params = WindowManager.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(150)
        }

        try {
            windowManager.addView(view, params)
            overlayView = view
            overlayShown = true
            overlayStatusJob = lifecycleScope.launch {
                SpikeProofState.state.collect { state ->
                    view.text = "●  ${state.hardwareKeyStatus}"
                }
            }
        } catch (_: SecurityException) {
            SpikeProofState.reportHardwareKey("Overlay-Freigabe fehlt")
        }
    }

    private fun hideOverlay() {
        overlayStatusJob?.cancel()
        overlayStatusJob = null
        overlayView?.let { view ->
            if (view.isAttachedToWindow) windowManager.removeView(view)
        }
        overlayView = null
        overlayShown = false
    }

    private fun isServiceEnabled(serviceClass: Class<*>): Boolean {
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ).orEmpty()
        val expected = ComponentName(this, serviceClass)
        return enabled.split(':').any { value ->
            ComponentName.unflattenFromString(value)?.let {
                it.packageName == expected.packageName && it.className == expected.className
            } == true
        }
    }

    private fun isInputMethodEnabled(): Boolean {
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_INPUT_METHODS,
        ).orEmpty()
        return enabled.split(':').any { value ->
            ComponentName.unflattenFromString(value.substringBefore(';'))?.className ==
                SpikeInputMethodService::class.java.name
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
