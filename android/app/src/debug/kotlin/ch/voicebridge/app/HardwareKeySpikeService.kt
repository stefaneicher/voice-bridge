package ch.voicebridge.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.InputMethod
import android.annotation.TargetApi
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.inputmethod.EditorInfo
import android.view.accessibility.AccessibilityEvent

/** Debug-only probe. It captures volume keys and inserts a fixed sample without reading editor text. */
@TargetApi(Build.VERSION_CODES.TIRAMISU)
class HardwareKeySpikeService : AccessibilityService() {
    private val handler = Handler(Looper.getMainLooper())
    private var accessibilityInputMethod: SpikeAccessibilityInputMethod? = null

    override fun onCreateInputMethod(): InputMethod =
        SpikeAccessibilityInputMethod(this).also { accessibilityInputMethod = it }

    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR
        }
        connectedService = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (connectedService === this) connectedService = null
        super.onDestroy()
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val name = when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> "Lauter"
            KeyEvent.KEYCODE_VOLUME_DOWN -> "Leiser"
            else -> return false
        }
        val action = when (event.action) {
            KeyEvent.ACTION_DOWN -> if (event.repeatCount == 0) "gedrückt" else return false
            KeyEvent.ACTION_UP -> "losgelassen"
            else -> return false
        }
        SpikeProofState.reportHardwareKey("$name $action · Ereignis weitergereicht")
        return false
    }

    private fun requestOverlayProbeInsert(): Boolean {
        val probeText = " Voice-Bridge-Probe"
        SpikeProofState.prepareInsertion(probeText)
        val inputMethod = accessibilityInputMethod
        if (inputMethod == null) {
            SpikeProofState.reportInsertion(
                "Bedienungshilfen-Eingabekanal nicht bereit · Prüftext behalten",
                keepText = true,
            )
            return true
        }

        val editor = inputMethod.currentInputEditorInfo
        if (editor == null) {
            SpikeProofState.reportInsertion("Kein Textfeld verfügbar · Prüftext behalten", keepText = true)
            return true
        }
        if (editor.inputType.isPasswordInput()) {
            SpikeProofState.reportInsertion("Passwortfeld erkannt · Einfügen gesperrt", keepText = true)
            return true
        }
        if (!editor.inputType.isTextInput()) {
            SpikeProofState.reportInsertion("Kein unterstütztes Textfeld · Prüftext behalten", keepText = true)
            return true
        }

        val token = inputMethod.sessionGuard.currentToken()
        if (token == null) {
            SpikeProofState.reportInsertion("Editor-Sitzung nicht verfügbar · Prüftext behalten", keepText = true)
            return true
        }

        handler.postDelayed({
            val currentEditor = inputMethod.currentInputEditorInfo
            val connection = inputMethod.currentInputConnection
            if (!inputMethod.sessionGuard.isCurrent(token, currentEditor?.identity()) || connection == null) {
                SpikeProofState.reportInsertion(
                    "Zielfeld gewechselt · nichts eingefügt · Prüftext behalten",
                    keepText = true,
                )
                return@postDelayed
            }

            connection.commitText(probeText, 1, null)
            SpikeProofState.reportInsertion(
                "Einfügeaufruf ausgeführt · Feld prüfen · Prüftext bleibt erhalten",
                keepText = true,
            )
        }, INSERT_DELAY_MS)
        return true
    }

    private fun EditorInfo.identity() = EditorIdentity(
        packageName = packageName,
        fieldId = fieldId,
        inputType = inputType,
        imeOptions = imeOptions,
    )

    companion object {
        private const val INSERT_DELAY_MS = 2_000L
        @Volatile private var connectedService: HardwareKeySpikeService? = null

        fun requestOverlayProbeInsert(): Boolean =
            connectedService?.requestOverlayProbeInsert() ?: false
    }
}

@TargetApi(Build.VERSION_CODES.TIRAMISU)
private class SpikeAccessibilityInputMethod(service: AccessibilityService) : InputMethod(service) {
    val sessionGuard = EditorSessionGuard()

    override fun onStartInput(attribute: EditorInfo, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        sessionGuard.onStartInput(attribute.identity())
    }

    override fun onFinishInput() {
        sessionGuard.onFinishInput()
        super.onFinishInput()
    }
}

private fun EditorInfo.identity() = EditorIdentity(
    packageName = packageName,
    fieldId = fieldId,
    inputType = inputType,
    imeOptions = imeOptions,
)
