package ch.voicebridge.app

import java.net.URI
import java.net.URLDecoder

/** Content of the QR code shown in the Voice-Bridge settings (`voicebridge://pair?...`). */
data class PairingInfo(
    val hosts: List<String>,
    val port: Int,
    /** SHA-256 of the PC certificate, lowercase hex. The app trusts only this certificate. */
    val fingerprint: String,
    val code: String,
    val pc: String,
) {
    companion object {
        private val HEX64 = Regex("^[0-9a-f]{64}$")

        fun parse(raw: String): PairingInfo? {
            val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
            if (uri.scheme != "voicebridge" || uri.host != "pair") return null
            val q = (uri.rawQuery ?: return null)
                .split('&')
                .mapNotNull { part ->
                    val i = part.indexOf('=')
                    if (i <= 0) null
                    else part.substring(0, i) to URLDecoder.decode(part.substring(i + 1), "UTF-8")
                }
                .toMap()
            val hosts = q["h"].orEmpty().split(',').filter { it.isNotBlank() }
            val port = q["p"]?.toIntOrNull() ?: return null
            val fp = q["fp"].orEmpty().lowercase()
            val code = q["c"].orEmpty()
            if (hosts.isEmpty() || port !in 1..65535 || !HEX64.matches(fp) || code.isEmpty()) return null
            return PairingInfo(hosts, port, fp, code, q["n"].orEmpty())
        }
    }
}
