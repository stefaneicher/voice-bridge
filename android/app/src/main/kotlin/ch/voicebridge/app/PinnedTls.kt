package ch.voicebridge.app

import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient

/**
 * Trusts exactly one certificate: the PC's self-signed certificate whose SHA-256 fingerprint came
 * with the QR code. No CA, no hostname check (the PC is reached by IP), but nothing else passes.
 */
class PinnedTrustManager(private val fingerprint: String) : X509TrustManager {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull() ?: throw CertificateException("Kein Zertifikat")
        val actual = sha256(leaf.encoded)
        if (!MessageDigest.isEqual(actual.toByteArray(), fingerprint.lowercase().toByteArray())) {
            throw CertificateException("Unbekannter PC (Zertifikat passt nicht zur Kopplung)")
        }
    }

    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw CertificateException("Not a server")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

    companion object {
        fun sha256(der: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(der).joinToString("") { "%02x".format(it) }
    }
}

fun pinnedClient(fingerprint: String): OkHttpClient {
    val trust = PinnedTrustManager(fingerprint)
    val ssl = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), SecureRandom()) }
    return OkHttpClient.Builder()
        .sslSocketFactory(ssl.socketFactory, trust)
        .hostnameVerifier { _, _ -> true } // identity is checked by the pinned fingerprint
        .connectTimeout(5, TimeUnit.SECONDS)
        .pingInterval(15, TimeUnit.SECONDS)
        .build()
}
