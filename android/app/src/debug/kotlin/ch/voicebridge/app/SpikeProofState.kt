package ch.voicebridge.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SpikeUiState(
    val hardwareKeyStatus: String = "Noch keine Hardwaretaste erkannt",
    val insertionStatus: String = "Einfügetest nicht gestartet",
    val pendingText: String? = null,
    val keyboardWindowStatus: String = "Noch keine Tastaturfenster-Messung",
)

object SpikeProofState {
    private val mutableState = MutableStateFlow(SpikeUiState())
    val state = mutableState.asStateFlow()

    fun reportHardwareKey(status: String) {
        mutableState.value = mutableState.value.copy(hardwareKeyStatus = status)
    }

    fun reportKeyboardWindow(visible: Boolean) {
        mutableState.value = mutableState.value.copy(
            keyboardWindowStatus = if (visible) {
                "Eingabemethoden-Fenster erkannt"
            } else {
                "Kein Eingabemethoden-Fenster erkannt"
            },
        )
    }

    fun prepareInsertion(text: String) {
        mutableState.value = mutableState.value.copy(
            insertionStatus = "Prüftext bleibt zur manuellen Kontrolle im Arbeitsspeicher",
            pendingText = text,
        )
    }

    fun reportInsertion(status: String, keepText: Boolean) {
        mutableState.value = mutableState.value.copy(
            insertionStatus = status,
            pendingText = if (keepText) mutableState.value.pendingText else null,
        )
    }
}
