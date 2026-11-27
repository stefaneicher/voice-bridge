package ch.voicebridge.app

import android.view.accessibility.AccessibilityWindowInfo

internal object KeyboardWindowPolicy {
    fun isInputMethodVisible(windowTypes: Iterable<Int>): Boolean =
        windowTypes.any { it == AccessibilityWindowInfo.TYPE_INPUT_METHOD }

    fun shouldShowOverlay(overlayEnabled: Boolean, inputMethodVisible: Boolean): Boolean =
        overlayEnabled && inputMethodVisible
}
