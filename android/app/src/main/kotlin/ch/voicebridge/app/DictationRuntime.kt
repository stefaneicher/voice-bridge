package ch.voicebridge.app

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class DictationPhase {
    DISABLED,
    READY,
    RECORDING,
    AWAITING_CONSENT,
    TRANSCRIBING,
    RESULT,
    ERROR,
}

data class DictationUiState(
    val phase: DictationPhase = DictationPhase.DISABLED,
    val message: String = "Overlay ist ausgeschaltet.",
    val text: String? = null,
    val audioAvailable: Boolean = false,
    val testLab: Boolean = false,
    val overlayEnabled: Boolean = false,
)

object DictationRuntime {
    private val mutableState = MutableStateFlow(DictationUiState())
    val state: StateFlow<DictationUiState> = mutableState

    internal fun update(state: DictationUiState) {
        mutableState.value = state
    }
}
