package ch.voicebridge.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.InputMethod
import android.annotation.TargetApi
import android.os.Build
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import android.view.inputmethod.EditorInfo

/** Inserts through the accessibility input-method channel and detects keyboards from window types only. */
@TargetApi(Build.VERSION_CODES.TIRAMISU)
class DictationAccessibilityService : AccessibilityService() {
    private var dictationInputMethod: DictationInputMethod? = null

    override fun onCreateInputMethod(): InputMethod =
        DictationInputMethod(this).also { dictationInputMethod = it }

    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        connectedService = this
        reportKeyboardVisibility()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        reportKeyboardVisibility()
    }

    override fun onInterrupt() {
        updateKeyboardVisibility(false)
    }

    override fun onDestroy() {
        updateKeyboardVisibility(false)
        if (connectedService === this) connectedService = null
        super.onDestroy()
    }

    private fun reportKeyboardVisibility() {
        val currentWindows = windows
        try {
            updateKeyboardVisibility(
                KeyboardWindowPolicy.isInputMethodVisible(
                    currentWindows.map(AccessibilityWindowInfo::getType),
                ),
            )
        } finally {
            currentWindows.forEach(AccessibilityWindowInfo::recycle)
        }
    }

    private fun updateKeyboardVisibility(visible: Boolean) {
        keyboardVisible = visible
        DictationForegroundService.onKeyboardVisibilityChanged(visible)
    }

    private fun currentWritableSession(): EditorSessionToken? {
        val inputMethod = dictationInputMethod ?: return null
        val editor = inputMethod.currentInputEditorInfo ?: return null
        if (!editor.inputType.isTextInput() || editor.inputType.isPasswordInput()) return null
        val token = inputMethod.sessionGuard.currentToken() ?: return null
        return token.takeIf { inputMethod.sessionGuard.isCurrent(it, editor.identity()) }
    }

    private fun isCurrent(token: EditorSessionToken): Boolean {
        val inputMethod = dictationInputMethod ?: return false
        return inputMethod.sessionGuard.isCurrent(
            token,
            inputMethod.currentInputEditorInfo?.identity(),
        )
    }

    private fun insert(token: EditorSessionToken, text: String): Boolean {
        val inputMethod = dictationInputMethod ?: return false
        val editor = inputMethod.currentInputEditorInfo ?: return false
        if (!inputMethod.sessionGuard.isCurrent(token, editor.identity())) return false
        if (!editor.inputType.isTextInput() || editor.inputType.isPasswordInput()) return false
        val connection = inputMethod.currentInputConnection ?: return false
        connection.commitText(text, 1, null)
        return true
    }

    private fun EditorInfo.identity() = EditorIdentity(
        packageName = packageName,
        fieldId = fieldId,
        inputType = inputType,
        imeOptions = imeOptions,
    )

    private class DictationInputMethod(service: AccessibilityService) : InputMethod(service) {
        val sessionGuard = EditorSessionGuard()

        override fun onStartInput(attribute: EditorInfo, restarting: Boolean) {
            super.onStartInput(attribute, restarting)
            sessionGuard.onStartInput(attribute.identity())
            DictationForegroundService.editorSessionChanged()
        }

        override fun onFinishInput() {
            sessionGuard.onFinishInput()
            DictationForegroundService.editorSessionChanged()
            super.onFinishInput()
        }

        private fun EditorInfo.identity() = EditorIdentity(
            packageName = packageName,
            fieldId = fieldId,
            inputType = inputType,
            imeOptions = imeOptions,
        )
    }

    companion object {
        @Volatile
        private var connectedService: DictationAccessibilityService? = null

        @Volatile
        private var keyboardVisible = false

        fun isKeyboardVisible(): Boolean = keyboardVisible

        fun currentWritableSession(): EditorSessionToken? =
            connectedService?.currentWritableSession()

        fun insert(token: EditorSessionToken, text: String): Boolean =
            connectedService?.insert(token, text) ?: false

        fun isCurrent(token: EditorSessionToken): Boolean =
            connectedService?.isCurrent(token) ?: false
    }
}
