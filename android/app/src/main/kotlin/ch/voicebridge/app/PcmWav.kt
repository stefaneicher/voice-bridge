package ch.voicebridge.app

/** Encodes mono PCM16 samples as a little-endian RIFF/WAVE file. */
object PcmWav {
    fun encode(pcm: ByteArray, sampleRate: Int = 16_000): ByteArray {
        require(sampleRate > 0)
        val dataSize = pcm.size
        val result = ByteArray(44 + dataSize)
        fun writeAscii(offset: Int, value: String) {
            value.encodeToByteArray().copyInto(result, offset)
        }
        fun writeShort(offset: Int, value: Int) {
            result[offset] = value.toByte()
            result[offset + 1] = (value ushr 8).toByte()
        }
        fun writeInt(offset: Int, value: Int) {
            result[offset] = value.toByte()
            result[offset + 1] = (value ushr 8).toByte()
            result[offset + 2] = (value ushr 16).toByte()
            result[offset + 3] = (value ushr 24).toByte()
        }

        writeAscii(0, "RIFF")
        writeInt(4, 36 + dataSize)
        writeAscii(8, "WAVE")
        writeAscii(12, "fmt ")
        writeInt(16, 16)
        writeShort(20, 1)
        writeShort(22, 1)
        writeInt(24, sampleRate)
        writeInt(28, sampleRate * 2)
        writeShort(32, 2)
        writeShort(34, 16)
        writeAscii(36, "data")
        writeInt(40, dataSize)
        pcm.copyInto(result, 44)
        return result
    }
}
