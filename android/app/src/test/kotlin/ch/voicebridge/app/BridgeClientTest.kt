package ch.voicebridge.app

import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.ByteString
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Connects the real client to a TLS WebSocket test server with a self-signed certificate. */
class BridgeClientTest {
    private val cert = HeldCertificate.Builder().commonName("Voice-Bridge").build()
    private val fingerprint = PinnedTrustManager.sha256(cert.certificate.encoded)
    private val server = MockWebServer()
    private val received = LinkedBlockingQueue<String>()
    private val audioBytes = LinkedBlockingQueue<Int>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val repo = InMemoryRepo()

    @Before
    fun setUp() {
        server.useHttps(HandshakeCertificates.Builder().heldCertificate(cert).build().sslSocketFactory())
        server.start()
    }

    @After
    fun tearDown() {
        scope.cancel()
        server.close()
    }

    private fun pcScript(vararg replies: String) {
        server.enqueue(
            MockResponse.Builder().webSocketUpgrade(object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    received.add(text)
                    replies.forEach(webSocket::send)
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    audioBytes.add(bytes.size)
                }

                override fun onOpen(webSocket: WebSocket, response: Response) = Unit

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null) // like the ws library on the PC
                }
            }).build(),
        )
    }

    private fun info(fp: String = fingerprint) =
        PairingInfo(listOf("10.255.255.1", server.hostName), server.port, fp, "c0de", "PC")

    @Test
    fun pairsLogsInListsTargetsAndStreamsAudio() = runBlocking {
        pcScript(
            """{"t":"paired","deviceId":"dev-1","token":"tok","pc":"Büro-PC","profile":"privat"}""",
            """{"t":"targets","sessions":[{"id":"pty:1","name":"billing","state":"idle"}]}""",
        )
        val client = BridgeClient(scope, repo, "Pixel", reconnectDelayMs = 60_000)
        client.pair(info())

        val connected = withTimeout(10_000) { client.connection.first { it is Connection.Connected } }
        assertEquals(Connection.Connected("Büro-PC", "privat"), connected)
        assertTrue(received.poll(5, TimeUnit.SECONDS)!!.contains("\"t\":\"pair\""))
        assertEquals("dev-1", repo.pairing?.deviceId)
        assertEquals("billing", withTimeout(5_000) { client.targets.first { it.isNotEmpty() } }.single().name)

        assertTrue(client.send(AppMessage.Start(Mode.AGENT, "pty:1")))
        assertTrue(client.sendAudio(ByteArray(640)))
        assertEquals(640, audioBytes.poll(5, TimeUnit.SECONDS))
        client.disconnect()
    }

    @Test
    fun refusesAPcWithAnotherCertificate() = runBlocking {
        pcScript()
        val other = "0".repeat(64)
        val client = BridgeClient(scope, repo, "Pixel", reconnectDelayMs = 60_000)
        client.pair(info(other))
        val state = withTimeout(10_000) { client.connection.first { it is Connection.Offline } }
        assertTrue(state is Connection.Offline)
        assertEquals(null, repo.pairing)
    }

    @Test
    fun forgetsThePairingWhenThePcNoLongerKnowsThePhone() = runBlocking {
        repo.pairing = Pairing(listOf(server.hostName), server.port, fingerprint, "dev-1", "old", "PC")
        pcScript("""{"t":"error","code":"auth","message":"Gerät nicht gekoppelt"}""")
        val client = BridgeClient(scope, repo, "Pixel", reconnectDelayMs = 60_000)
        client.connect()
        withTimeout(10_000) { client.connection.first { it == Connection.Unpaired } }
        assertEquals(null, repo.pairing)
    }
}

private class InMemoryRepo : PairingStorage {
    @Volatile var pairing: Pairing? = null

    override fun load() = pairing

    override fun save(pairing: Pairing) {
        this.pairing = pairing
    }

    override fun clear() {
        pairing = null
    }
}
