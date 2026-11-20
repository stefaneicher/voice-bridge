package ch.voicebridge.app

import kotlinx.coroutines.runBlocking
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class OpenAiTranscriberTest {
    private val server = MockWebServer()

    @Before
    fun startServer() {
        server.start()
    }

    @After
    fun stopServer() {
        server.close()
    }

    @Test
    fun postsWavAndDecodesTranscript() = runBlocking {
        server.enqueue(MockResponse.Builder().body("""{"text":"Grüezi"}""").build())

        val result = transcriber().transcribe(byteArrayOf(1, 2, 3), "sk-test")
        val request = server.takeRequest()
        val requestBody = request.body!!.utf8()

        assertEquals("Grüezi", result)
        assertEquals("POST", request.method)
        assertEquals("Bearer sk-test", request.headers["Authorization"])
        assertTrue(requestBody.contains("name=\"model\"\r\n\r\ngpt-4o-transcribe"))
        assertTrue(requestBody.contains("name=\"language\"\r\n\r\nde"))
        assertTrue(requestBody.contains("recording.wav"))
        assertTrue(requestBody.contains("Content-Type: audio/wav"))
    }

    @Test
    fun reportsHttpFailuresWithoutReturningSuccessfulFallback() = runBlocking {
        server.enqueue(MockResponse.Builder().code(429).build())

        val failure = try {
            transcriber().transcribe(byteArrayOf(1), "sk-test")
            null
        } catch (error: OpenAiHttpException) {
            error
        }

        assertEquals(429, failure?.statusCode)
        assertEquals("OpenAI-Limit erreicht. Prüfe Guthaben und Abrechnung.", failure?.message)
    }

    private fun transcriber() = OpenAiTranscriber(
        client = OkHttpClient(),
        endpoint = server.url("/v1/audio/transcriptions").toString(),
    )
}
