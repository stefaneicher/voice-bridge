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
import android.view.MotionEvent
import android.view.ViewConfiguration
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
import ch.voicebridge.app.ui.VB
import ch.voicebridge.app.ui.VoiceBridgeTheme
import kotlin.math.abs

class AndroidDictationSpikeActivity : ComponentActivity() {
    private var resumedTick by mutableIntStateOf(0)
    private var overlayShown by mutableStateOf(false)
    private var overlayView: TextView? = null
    private var overlayX = 0
    private var overlayY: Int? = null

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
                            Text(if (accessibilityEnabled) "Bedienungshilfe bereit" else "Bedienungshilfe einrichten")
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
                        "Der Debug-Dienst beobachtet Lauter/Leiser und gibt die Tasten weiter. " +
                            "Hardware-PTT wird nicht verwendet; die Lautstärke bleibt bedienbar.",
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
                            "Dieses Verfahren ersetzt während des Tests Samsung Keyboard.",
                        color = VB.Text3,
                    )
                    state.pendingText?.let { text ->
                        Text("Erhaltener Prüftext: «$text»", color = VB.Lime)
                        OutlinedButton(onClick = { clipboard.setText(AnnotatedString(text)) }) {
                            Text("Prüftext kopieren")
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    Text("Einfügetest mit Overlay und bestehender Tastatur", color = VB.Text)
                    Text(
                        "Aktiviere den Bedienungshilfen-Dienst und blende das Overlay ein. " +
                            "Ziehe die Pill zum Verschieben; kurzes Tippen startet den Einfügetest. " +
                            "Wechsle danach z. B. zu Gmail und tippe im Textfeld auf «Voice-Bridge-Test · Prüftext»; " +
                            "nach 2 Sekunden wird " +
                            "derselbe Editor geprüft und nur der feste Prüftext eingefügt. " +
                            "Wechsle während der Wartezeit zu einem anderen Feld, um den Abbruch zu prüfen. " +
                            "Diese API benötigt Android 13 oder neuer.",
                        color = VB.Text3,
                    )
                    Text("Letzter Einfügetest: ${state.insertionStatus}", color = VB.Text2)
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
            text = "●  Voice-Bridge-Test · Prüftext"
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
            x = overlayX
            y = overlayY ?: dp(150)
        }
        var downRawX = 0f
        var downRawY = 0f
        var startX = params.x
        var startY = params.y
        var dragging = false
        val touchSlop = ViewConfiguration.get(this).scaledTouchSlop
        view.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    startX = params.x
                    startY = params.y
                    dragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val deltaX = event.rawX - downRawX
                    val deltaY = event.rawY - downRawY
                    if (!dragging && (abs(deltaX) > touchSlop || abs(deltaY) > touchSlop)) {
                        dragging = true
                    }
                    if (dragging) {
                        val maxHorizontalOffset =
                            ((resources.displayMetrics.widthPixels - view.width) / 2).coerceAtLeast(0)
                        val maxVerticalOffset =
                            (resources.displayMetrics.heightPixels - view.height).coerceAtLeast(0)
                        params.x = (startX + deltaX.toInt()).coerceIn(-maxHorizontalOffset, maxHorizontalOffset)
                        params.y = (startY - deltaY.toInt()).coerceIn(0, maxVerticalOffset)
                        windowManager.updateViewLayout(view, params)
                        overlayX = params.x
                        overlayY = params.y
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragging) requestOverlayProbeInsert()
                    true
                }
                MotionEvent.ACTION_CANCEL -> true
                else -> false
            }
        }

        try {
            windowManager.addView(view, params)
            overlayView = view
            overlayShown = true
        } catch (_: SecurityException) {
            SpikeProofState.reportHardwareKey("Overlay-Freigabe fehlt")
        }
    }

    private fun requestOverlayProbeInsert() {
        if (!HardwareKeySpikeService.requestOverlayProbeInsert()) {
            SpikeProofState.prepareInsertion(" Voice-Bridge-Probe")
            SpikeProofState.reportInsertion(
                "Bedienungshilfen-Dienst nicht verbunden · Prüftext behalten",
                keepText = true,
            )
        }
    }

    private fun hideOverlay() {
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
        val inputMethodManager = getSystemService(InputMethodManager::class.java) ?: return false
        return inputMethodManager.enabledInputMethodList.any {
            it.packageName == packageName && it.serviceName == SpikeInputMethodService::class.java.name
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
