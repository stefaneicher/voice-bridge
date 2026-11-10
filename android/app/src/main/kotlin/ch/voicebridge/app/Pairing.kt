package ch.voicebridge.app

import android.content.Context
import kotlinx.serialization.Serializable

/** Credentials of the paired PC. The token is only valid together with this PC's certificate. */
@Serializable
data class Pairing(
    val hosts: List<String>,
    val port: Int,
    val fingerprint: String,
    val deviceId: String,
    val token: String,
    val pc: String,
)

/** Where the pairing lives. Separate from Android so the connection logic is testable. */
interface PairingStorage {
    fun load(): Pairing?
    fun save(pairing: Pairing)
    fun clear()
}

/** Stores the pairing in the app's private preferences (not readable by other apps). */
class PairingRepository(context: Context) : PairingStorage {
    private val prefs = context.getSharedPreferences("pairing", Context.MODE_PRIVATE)

    override fun load(): Pairing? = prefs.getString(KEY, null)?.let {
        runCatching { Wire.json.decodeFromString(Pairing.serializer(), it) }.getOrNull()
    }

    override fun save(pairing: Pairing) {
        prefs.edit().putString(KEY, Wire.json.encodeToString(Pairing.serializer(), pairing)).apply()
    }

    override fun clear() {
        prefs.edit().remove(KEY).apply()
    }

    var lastTarget: String
        get() = prefs.getString(TARGET, CURSOR) ?: CURSOR
        set(value) = prefs.edit().putString(TARGET, value).apply()

    companion object {
        private const val KEY = "pairing"
        private const val TARGET = "lastTarget"
        const val CURSOR = "cursor"
    }
}
