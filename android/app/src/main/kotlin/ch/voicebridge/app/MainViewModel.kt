package ch.voicebridge.app

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** What the PC answered to the last recording. */
sealed interface Outcome {
    data class Working(val label: String) : Outcome
    data class Sent(val text: String, val target: String?) : Outcome
    data class Failed(val message: String, val text: String?) : Outcome
}

data class RecordingState(val active: Boolean = false, val startedAt: Long = 0L, val levels: List<Float> = List(16) { 0.1f })

data class UiState(
    val connection: Connection,
    val targets: List<Target>,
    val selected: String,
    val recording: RecordingState,
    val outcome: Outcome?,
    val pairingError: String?,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = PairingRepository(app)
    val client = BridgeClient(viewModelScope, repo, deviceName())

    private val selected = MutableStateFlow(repo.lastTarget)
    private val recording = MutableStateFlow(RecordingState())
    private val outcome = MutableStateFlow<Outcome?>(null)
    private val pairingError = MutableStateFlow<String?>(null)
    private var clearOutcome: Job? = null

    private val capture = AudioCapture { bytes, length, level ->
        client.sendAudio(bytes, length)
        recording.value = recording.value.copy(levels = recording.value.levels.drop(1) + level.coerceAtLeast(0.1f))
    }

    val state: StateFlow<UiState> = combine(
        client.connection,
        client.targets,
        selected,
        recording,
        combine(outcome, pairingError) { o, e -> o to e },
    ) { connection, targets, sel, rec, (out, pairErr) ->
        UiState(connection, targets, sel, rec, out, pairErr)
    }.stateIn(
        viewModelScope,
        SharingStarted.Eagerly,
        UiState(client.connection.value, emptyList(), selected.value, RecordingState(), null, null),
    )

    init {
        viewModelScope.launch {
            client.events.collect { msg ->
                when (msg) {
                    is PcMessage.Status -> when (msg.phase) {
                        "working" -> outcome.value = Outcome.Working(msg.label ?: "Verarbeite …")
                        "idle" -> if (outcome.value is Outcome.Working) outcome.value = null
                        else -> Unit
                    }
                    is PcMessage.Result -> {
                        outcome.value = if (msg.ok) {
                            Outcome.Sent(msg.text.orEmpty(), msg.target)
                        } else {
                            Outcome.Failed(msg.message ?: "Fehler", msg.text)
                        }
                        if (msg.ok) autoClear()
                    }
                    is PcMessage.Error -> when (msg.code) {
                        "pairing", "auth" -> pairingError.value = msg.message
                        else -> outcome.value = Outcome.Failed(msg.message, null)
                    }
                    else -> Unit
                }
            }
        }
        client.connect()
    }

    fun onQrScanned(raw: String?) {
        val info = raw?.let(PairingInfo::parse)
        if (info == null) {
            pairingError.value = "Das ist kein Voice-Bridge-QR-Code."
            return
        }
        pairingError.value = null
        client.pair(info)
    }

    fun select(target: String) {
        selected.value = target
        repo.lastTarget = target
    }

    fun reconnect() = client.connect()

    fun unpair() = client.unpair()

    fun dismissOutcome() {
        outcome.value = null
    }

    /** Button pressed: start streaming. Returns false if the microphone could not start. */
    fun startRecording(): Boolean {
        if (recording.value.active || client.connection.value !is Connection.Connected) return false
        val target = selected.value
        val start = if (target == PairingRepository.CURSOR) {
            AppMessage.Start(Mode.DICTATE)
        } else {
            // Never redirect silently: a vanished session must be chosen again by the user.
            if (client.targets.value.none { it.id == target }) {
                outcome.value = Outcome.Failed("Die gewählte Session ist nicht mehr da. Bitte ein anderes Ziel wählen.", null)
                return false
            }
            AppMessage.Start(Mode.AGENT, target)
        }
        if (!client.send(start)) return false
        if (!capture.start(viewModelScope)) {
            client.send(AppMessage.Cancel)
            outcome.value = Outcome.Failed("Mikrofon nicht verfügbar", null)
            return false
        }
        clearOutcome?.cancel()
        outcome.value = null
        recording.value = RecordingState(active = true, startedAt = System.currentTimeMillis())
        return true
    }

    /** Button released: send the rest and let the PC process it. */
    fun stopRecording() {
        if (!recording.value.active) return
        viewModelScope.launch {
            capture.stop()
            client.send(AppMessage.Stop)
            recording.value = RecordingState()
            outcome.value = Outcome.Working("Transkribiere …")
        }
    }

    private fun autoClear() {
        clearOutcome?.cancel()
        clearOutcome = viewModelScope.launch {
            delay(6_000)
            if (outcome.value is Outcome.Sent) outcome.value = null
        }
    }

    override fun onCleared() {
        client.disconnect()
    }

    private fun deviceName(): String {
        val model = Build.MODEL.orEmpty()
        val maker = Build.MANUFACTURER.orEmpty()
        return (if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model").trim().ifEmpty { "Android" }
    }
}
