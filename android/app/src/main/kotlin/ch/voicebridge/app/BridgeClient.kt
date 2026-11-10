package ch.voicebridge.app

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

sealed interface Connection {
    data object Unpaired : Connection
    data object Connecting : Connection
    data class Connected(val pc: String, val profile: String) : Connection
    data class Offline(val reason: String) : Connection
}

/**
 * WebSocket connection to the PC. Tries each address from the QR code in turn, logs in with the
 * device token and reconnects after drops. Pairing and login failures are not retried.
 */
class BridgeClient(
    private val scope: CoroutineScope,
    private val repo: PairingStorage,
    private val deviceName: String,
    private val clientFactory: (String) -> OkHttpClient = ::pinnedClient,
    private val reconnectDelayMs: Long = 5_000,
) {
    private val _connection = MutableStateFlow<Connection>(
        if (repo.load() == null) Connection.Unpaired else Connection.Offline("Noch nicht verbunden"),
    )
    val connection: StateFlow<Connection> = _connection

    private val _targets = MutableStateFlow<List<Target>>(emptyList())
    val targets: StateFlow<List<Target>> = _targets

    private val _events = MutableSharedFlow<PcMessage>(extraBufferCapacity = 32)
    /** Status, results and errors from the PC. */
    val events: SharedFlow<PcMessage> = _events

    private var socket: WebSocket? = null
    private var reconnect: Job? = null
    private var generation = 0

    /** Pairs with a fresh QR code. */
    fun pair(info: PairingInfo) {
        open(info.hosts, info.port, info.fingerprint, AppMessage.Pair(code = info.code, device = deviceName)) {
            msg ->
            if (msg is PcMessage.Paired) {
                repo.save(Pairing(info.hosts, info.port, info.fingerprint, msg.deviceId, msg.token, msg.pc))
            }
        }
    }

    /** Connects with the stored pairing. */
    fun connect() {
        val p = repo.load() ?: run {
            _connection.value = Connection.Unpaired
            return
        }
        if (_connection.value is Connection.Connected || _connection.value == Connection.Connecting) return
        open(p.hosts, p.port, p.fingerprint, AppMessage.Hello(deviceId = p.deviceId, token = p.token)) {}
    }

    fun unpair() {
        disconnect()
        repo.clear()
        _targets.value = emptyList()
        _connection.value = Connection.Unpaired
    }

    fun disconnect() {
        generation++
        reconnect?.cancel()
        socket?.close(1000, null)
        socket = null
    }

    fun send(message: AppMessage): Boolean = socket?.send(Wire.encode(message)) ?: false

    fun sendAudio(bytes: ByteArray, length: Int = bytes.size): Boolean =
        socket?.send(bytes.toByteString(0, length)) ?: false

    private fun open(
        hosts: List<String>,
        port: Int,
        fingerprint: String,
        first: AppMessage,
        onAuth: (PcMessage) -> Unit,
    ) {
        disconnect()
        val gen = ++generation
        _connection.value = Connection.Connecting
        val client = clientFactory(fingerprint)

        fun attempt(index: Int) {
            if (gen != generation) return
            if (index >= hosts.size) {
                _connection.value = Connection.Offline("PC nicht erreichbar. Gleiches WLAN? Voice-Bridge gestartet?")
                scheduleReconnect(gen, first)
                return
            }
            val host = hosts[index]
            val url = "wss://${if (host.contains(':')) "[$host]" else host}:$port$PATH"
            var opened = false
            client.newWebSocket(
                Request.Builder().url(url).build(),
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        if (gen != generation) return webSocket.cancel()
                        opened = true
                        socket = webSocket
                        webSocket.send(Wire.encode(first))
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        if (gen != generation) return
                        when (val msg = Wire.decode(text) ?: return) {
                            is PcMessage.Paired -> {
                                onAuth(msg)
                                _connection.value = Connection.Connected(msg.pc, msg.profile)
                            }
                            is PcMessage.Welcome -> _connection.value = Connection.Connected(msg.pc, msg.profile)
                            is PcMessage.Targets -> _targets.value = msg.sessions
                            is PcMessage.Error -> handleError(msg)
                            else -> _events.tryEmit(msg)
                        }
                    }

                    override fun onMessage(webSocket: WebSocket, bytes: ByteString) = Unit

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = dropped(gen)

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        if (gen != generation) return
                        if (!opened) attempt(index + 1) else dropped(gen)
                    }
                },
            )
        }
        attempt(0)
    }

    private fun handleError(error: PcMessage.Error) {
        when (error.code) {
            "auth", "pairing" -> {
                // The PC no longer knows this phone, or the QR code was wrong: pair again.
                disconnect()
                if (error.code == "auth") repo.clear()
                _connection.value = if (repo.load() == null) Connection.Unpaired else Connection.Offline(error.message)
                _events.tryEmit(error)
            }
            "version" -> {
                disconnect()
                _connection.value = Connection.Offline(error.message)
            }
            else -> _events.tryEmit(error)
        }
    }

    private fun dropped(gen: Int) {
        if (gen != generation) return
        socket = null
        if (_connection.value is Connection.Connected || _connection.value == Connection.Connecting) {
            _connection.value = Connection.Offline("Verbindung unterbrochen")
        }
        repo.load()?.let { p ->
            scheduleReconnect(gen, AppMessage.Hello(deviceId = p.deviceId, token = p.token))
        }
    }

    private fun scheduleReconnect(gen: Int, first: AppMessage) {
        if (first !is AppMessage.Hello) return // a failed pairing is not retried
        reconnect?.cancel()
        reconnect = scope.launch {
            delay(reconnectDelayMs)
            if (gen == generation) {
                _connection.value = Connection.Offline("Neuer Versuch …")
                connect()
            }
        }
    }
}
