package ch.voicebridge.app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo

/** Debug-only probe. It reads window types only and never accesses window roots or nodes. */
class KeyboardWindowProbeService : AccessibilityService() {
    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
        }
        reportInputMethodWindow()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        reportInputMethodWindow()
    }

    override fun onInterrupt() = Unit

    private fun reportInputMethodWindow() {
        val windows = windows
        try {
            SpikeProofState.reportKeyboardWindow(
                KeyboardWindowPolicy.isInputMethodVisible(windows.map(AccessibilityWindowInfo::getType)),
            )
        } finally {
            windows.forEach(AccessibilityWindowInfo::recycle)
        }
    }
}
