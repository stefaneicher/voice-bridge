package ch.voicebridge.app

import android.view.accessibility.AccessibilityWindowInfo
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeyboardWindowPolicyTest {
    @Test
    fun detectsInputMethodWindowWithoutInspectingOtherWindowProperties() {
        assertTrue(
            KeyboardWindowPolicy.isInputMethodVisible(
                listOf(AccessibilityWindowInfo.TYPE_APPLICATION, AccessibilityWindowInfo.TYPE_INPUT_METHOD),
            ),
        )
    }

    @Test
    fun returnsFalseWhenNoInputMethodWindowExists() {
        assertFalse(
            KeyboardWindowPolicy.isInputMethodVisible(
                listOf(AccessibilityWindowInfo.TYPE_APPLICATION, AccessibilityWindowInfo.TYPE_SYSTEM),
            ),
        )
    }

    @Test
    fun showsOverlayOnlyWhenEnabledAndKeyboardVisible() {
        assertTrue(KeyboardWindowPolicy.shouldShowOverlay(overlayEnabled = true, inputMethodVisible = true))
        assertFalse(KeyboardWindowPolicy.shouldShowOverlay(overlayEnabled = true, inputMethodVisible = false))
        assertFalse(KeyboardWindowPolicy.shouldShowOverlay(overlayEnabled = false, inputMethodVisible = true))
        assertFalse(KeyboardWindowPolicy.shouldShowOverlay(overlayEnabled = false, inputMethodVisible = false))
    }
}
