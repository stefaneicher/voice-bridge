package ch.voicebridge.app

import android.text.InputType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccessibilityInputPolicyTest {
    @Test
    fun acceptsOnlyTextEditors() {
        assertTrue((InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_NORMAL).isTextInput())
        assertFalse(InputType.TYPE_CLASS_NUMBER.isTextInput())
    }

    @Test
    fun rejectsRecognizedTextAndNumericPasswordEditors() {
        assertTrue((InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD).isPasswordInput())
        assertTrue(
            (InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD).isPasswordInput(),
        )
        assertFalse((InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_NORMAL).isPasswordInput())
    }
}
