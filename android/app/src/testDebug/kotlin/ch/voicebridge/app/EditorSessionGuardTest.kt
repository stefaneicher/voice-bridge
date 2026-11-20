package ch.voicebridge.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EditorSessionGuardTest {
    private val firstEditor = EditorIdentity(
        packageName = "example.notes",
        fieldId = 12,
        inputType = 1,
        imeOptions = 0,
    )

    @Test
    fun acceptsTheOriginalEditorSession() {
        val guard = EditorSessionGuard()
        val token = guard.onStartInput(firstEditor)

        assertTrue(guard.isCurrent(token, firstEditor))
    }

    @Test
    fun rejectsAnEditorSwitchEvenWhenThePackageIsTheSame() {
        val guard = EditorSessionGuard()
        val token = guard.onStartInput(firstEditor)
        val secondEditor = firstEditor.copy(fieldId = 13)
        guard.onStartInput(secondEditor)

        assertFalse(guard.isCurrent(token, secondEditor))
    }

    @Test
    fun rejectsLeavingAndReturningToTheSameEditor() {
        val guard = EditorSessionGuard()
        val token = guard.onStartInput(firstEditor)
        guard.onFinishInput()
        guard.onStartInput(firstEditor)

        assertFalse(guard.isCurrent(token, firstEditor))
    }

    @Test
    fun rejectsMissingCurrentEditor() {
        val guard = EditorSessionGuard()
        val token = guard.onStartInput(firstEditor)

        assertFalse(guard.isCurrent(token, null))
    }
}
