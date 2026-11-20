package ch.voicebridge.app

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerializationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class OpenAiHttpException(val statusCode: Int) : IOException(
    when (statusCode) {
        401, 403 -> "Der OpenAI-API-Schlüssel wurde abgelehnt."
        429 -> "OpenAI-Limit erreicht. Prüfe Guthaben und Abrechnung."
        in 500..599 -> "OpenAI ist vorübergehend nicht verfügbar."
        else -> "OpenAI-Anfrage fehlgeschlagen (HTTP $statusCode)."
    },
)

class OpenAiTranscriber(
    private val client: OkHttpClient = defaultClient(),
    private val endpoint: String = ENDPOINT,
) {
    suspend fun transcribe(wav: ByteArray, apiKey: String): String = withContext(Dispatchers.IO) {
        if (wav.isEmpty()) throw IOException("Die Aufnahme ist leer.")
        if (apiKey.isBlank()) throw IOException("Kein OpenAI-API-Schlüssel hinterlegt.")

        val file = wav.toRequestBody("audio/wav".toMediaType())
        val body = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", "recording.wav", file)
            .addFormDataPart("model", MODEL)
            .addFormDataPart("language", "de")
            .addFormDataPart("response_format", "json")
            .build()
        val request = Request.Builder()
            .url(endpoint)
            .header("Authorization", "Bearer $apiKey")
            .post(body)
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw OpenAiHttpException(response.code)
            val payload = response.body?.string() ?: throw IOException("OpenAI lieferte keine Antwort.")
            val transcript = try {
                JSON.decodeFromString<TranscriptionResponse>(payload).text.trim()
            } catch (error: SerializationException) {
                throw IOException("OpenAI lieferte ein ungültiges Transkriptionsformat.", error)
            }
            transcript
        }
    }

    @Serializable
    private data class TranscriptionResponse(val text: String)

    private companion object {
        const val ENDPOINT = "https://api.openai.com/v1/audio/transcriptions"
        const val MODEL = "gpt-4o-transcribe"
        val JSON = Json { ignoreUnknownKeys = true }

        fun defaultClient() = OkHttpClient.Builder()
            .callTimeout(3, TimeUnit.MINUTES)
            .build()
    }
}
