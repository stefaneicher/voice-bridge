package ch.voicebridge.app

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonClassDiscriminator

/** Protocol with the Voice-Bridge PC app (see src/remote/protocol.ts). */
const val PROTOCOL_VERSION = 1
const val SAMPLE_RATE = 16_000
const val PATH = "/vb"

@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("t")
sealed interface AppMessage {
    @Serializable @SerialName("pair")
    data class Pair(val v: Int = PROTOCOL_VERSION, val code: String, val device: String) : AppMessage

    @Serializable @SerialName("hello")
    data class Hello(val v: Int = PROTOCOL_VERSION, val deviceId: String, val token: String) : AppMessage

    @Serializable @SerialName("start")
    data class Start(val mode: Mode, val target: String? = null) : AppMessage

    @Serializable @SerialName("stop")
    data object Stop : AppMessage

    @Serializable @SerialName("cancel")
    data object Cancel : AppMessage

    @Serializable @SerialName("ping")
    data object Ping : AppMessage
}

@Serializable
enum class Mode {
    @SerialName("dictate") DICTATE,
    @SerialName("agent") AGENT,
}

@Serializable
data class Target(val id: String, val name: String, val title: String? = null, val state: String = "unknown")

@OptIn(ExperimentalSerializationApi::class)
@Serializable
@JsonClassDiscriminator("t")
sealed interface PcMessage {
    @Serializable @SerialName("paired")
    data class Paired(val deviceId: String, val token: String, val pc: String, val profile: String) : PcMessage

    @Serializable @SerialName("welcome")
    data class Welcome(val pc: String, val profile: String) : PcMessage

    @Serializable @SerialName("error")
    data class Error(val code: String, val message: String) : PcMessage

    @Serializable @SerialName("targets")
    data class Targets(val sessions: List<Target>) : PcMessage

    @Serializable @SerialName("status")
    data class Status(val phase: String, val label: String? = null) : PcMessage

    @Serializable @SerialName("result")
    data class Result(
        val ok: Boolean,
        val text: String? = null,
        val target: String? = null,
        val kind: String? = null,
        val message: String? = null,
    ) : PcMessage

    @Serializable @SerialName("pong")
    data object Pong : PcMessage
}

object Wire {
    val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    fun encode(message: AppMessage): String = json.encodeToString(AppMessage.serializer(), message)

    /** Returns null for messages this app version does not understand. */
    fun decode(text: String): PcMessage? =
        runCatching { json.decodeFromString(PcMessage.serializer(), text) }.getOrNull()
}
