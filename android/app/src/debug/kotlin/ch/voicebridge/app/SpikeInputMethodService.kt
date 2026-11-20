package ch.voicebridge.app

import android.inputmethodservice.InputMethodService
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Minimal IME probe for delayed insertion into the original editor session. */
class SpikeInputMethodService : InputMethodService() {
    private val handler = Handler(Looper.getMainLooper())
    private val sessionGuard = EditorSessionGuard()

    override fun onCreateInputView(): View =
        LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 16, 24, 18)
            setBackgroundColor(0xFF15151C.toInt())
            addView(
                TextView(context).apply {
                    text = "VOICE-BRIDGE · EINFEGETEST"
                    setTextColor(0xFFA3D858.toInt())
                    textSize = 12f
                    gravity = Gravity.CENTER
                },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 40),
            )
            addView(
                Button(context).apply {
                    text = "Prüftext in 2 s einfügen"
                    setOnClickListener { requestProbeInsert() }
                },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 52),
            )
            addView(
                TextView(context).apply {
                    text = "Tippen zum Testen · kein Enter"
                    setTextColor(0xFFC6CAD3.toInt())
                    textSize = 12f
                    gravity = Gravity.CENTER
                },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 36),
            )
        }

    override fun onStartInput(attribute: EditorInfo, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        sessionGuard.onStartInput(attribute.identity())
    }

    override fun onFinishInput() {
        sessionGuard.onFinishInput()
        super.onFinishInput()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    private fun requestProbeInsert() {
        val probeText = " Voice-Bridge-Probe"
        SpikeProofState.prepareInsertion(probeText)
        val editor = currentInputEditorInfo
        if (editor == null || !isTextInput(editor.inputType)) {
            SpikeProofState.reportInsertion("Kein Textfeld verfügbar · Prüftext behalten", keepText = true)
            return
        }
        if (isPasswordInput(editor.inputType)) {
            SpikeProofState.reportInsertion("Passwortfeld erkannt · Einfügen gesperrt", keepText = true)
            return
        }

        val token = sessionGuard.currentToken()
        if (token == null) {
            SpikeProofState.reportInsertion("Editor-Sitzung nicht verfügbar · Prüftext behalten", keepText = true)
            return
        }
        handler.postDelayed({
            val currentEditor = currentInputEditorInfo
            if (!sessionGuard.isCurrent(token, currentEditor?.identity()) || currentInputConnection == null) {
                SpikeProofState.reportInsertion(
                    "Zielfeld gewechselt · nichts eingefügt · Prüftext behalten",
                    keepText = true,
                )
                return@postDelayed
            }

            val inserted = currentInputConnection?.commitText(probeText, 1) == true
            SpikeProofState.reportInsertion(
                if (inserted) "Prüftext eingefügt · kein automatisches Absenden"
                else "Einfügen fehlgeschlagen · Prüftext behalten",
                keepText = !inserted,
            )
        }, INSERT_DELAY_MS)
    }

    private fun isTextInput(inputType: Int): Boolean =
        inputType and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT

    private fun EditorInfo.identity() = EditorIdentity(
        packageName = packageName,
        fieldId = fieldId,
        inputType = inputType,
        imeOptions = imeOptions,
    )

    private fun isPasswordInput(inputType: Int): Boolean {
        if (inputType and InputType.TYPE_MASK_CLASS != InputType.TYPE_CLASS_TEXT) return false
        val variation = inputType and InputType.TYPE_MASK_VARIATION
        return variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
    }

    companion object {
        private const val INSERT_DELAY_MS = 2_000L
    }
}
