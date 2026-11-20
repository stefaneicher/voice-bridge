package ch.voicebridge.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface ApiKeyStore {
    fun load(): String?
    fun save(apiKey: String)
    fun delete()
}

/** Stores only AES-GCM ciphertext in a private, backup-excluded preferences file. */
class AndroidApiKeyStore(context: Context) : ApiKeyStore {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    @Synchronized
    override fun load(): String? {
        val encoded = preferences.getString(KEY, null) ?: return null
        val payload = try {
            Base64.decode(encoded, Base64.NO_WRAP)
        } catch (error: IllegalArgumentException) {
            throw IOException("Der gespeicherte API-Schlüssel ist beschädigt.", error)
        }
        if (payload.size <= IV_BYTES + TAG_BYTES) {
            throw IOException("Der gespeicherte API-Schlüssel ist unvollständig.")
        }
        val iv = payload.copyOfRange(0, IV_BYTES)
        val encrypted = payload.copyOfRange(IV_BYTES, payload.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_BITS, iv))
        return String(cipher.doFinal(encrypted), StandardCharsets.UTF_8)
    }

    @Synchronized
    override fun save(apiKey: String) {
        val normalized = apiKey.trim()
        require(normalized.isNotEmpty()) { "Der API-Schlüssel darf nicht leer sein." }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(normalized.toByteArray(StandardCharsets.UTF_8))
        val payload = cipher.iv + encrypted
        if (!preferences.edit().putString(KEY, Base64.encodeToString(payload, Base64.NO_WRAP)).commit()) {
            throw IOException("Der API-Schlüssel konnte nicht gespeichert werden.")
        }
    }

    @Synchronized
    override fun delete() {
        if (!preferences.edit().remove(KEY).commit()) {
            throw IOException("Der API-Schlüssel konnte nicht gelöscht werden.")
        }
        val keyStore = loadKeyStore()
        if (keyStore.containsAlias(KEY_ALIAS)) keyStore.deleteEntry(KEY_ALIAS)
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = loadKeyStore()
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return generator.generateKey()
    }

    private fun loadKeyStore(): KeyStore =
        KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }

    private companion object {
        const val PREFERENCES = "dictation_keys"
        const val KEY = "openai_api_key"
        const val KEY_ALIAS = "voice_bridge_openai_api_key"
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
        const val TAG_BITS = 128
        const val TAG_BYTES = TAG_BITS / 8
    }
}
