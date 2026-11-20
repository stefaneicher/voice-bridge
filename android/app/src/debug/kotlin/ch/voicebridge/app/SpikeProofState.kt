package ch.voicebridge.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

data class SpikeUiState(
    val hardwareKeyStatus: String = "Noch keine Hardwaretaste erkannt",
    val insertionStatus: String = "Einfügetest nicht gestartet",
    val pendingText: String? = null,
)

object SpikeProofState {
    private val mutableState = MutableStateFlow(SpikeUiState())
    val state = mutableState.asStateFlow()

    fun reportHardwareKey(status: String) {
        mutableState.value = mutableState.value.copy(hardwareKeyStatus = status)
    }

    fun prepareInsertion(text: String) {
        mutableState.value = mutableState.value.copy(
            insertionStatus = "Prüftext bleibt im Arbeitsspeicher, bis das Ziel bestätigt ist",
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
