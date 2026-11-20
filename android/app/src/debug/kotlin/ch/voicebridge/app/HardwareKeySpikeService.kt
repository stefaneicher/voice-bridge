package ch.voicebridge.app

import android.accessibilityservice.AccessibilityService
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent

/** Debug-only probe. It observes volume-key events and never consumes or remaps them. */
class HardwareKeySpikeService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

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
}
