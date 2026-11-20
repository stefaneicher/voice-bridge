package ch.voicebridge.app

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class PcmWavTest {
    @Test
    fun encodesMonoPcm16WavHeaderAndPayload() {
        val pcm = byteArrayOf(1, 2, 3, 4)

        val wav = PcmWav.encode(pcm)

        assertEquals(48, wav.size)
        assertEquals("RIFF", wav.copyOfRange(0, 4).decodeToString())
        assertEquals(40, littleEndianInt(wav, 4))
        assertEquals("WAVE", wav.copyOfRange(8, 12).decodeToString())
        assertEquals(16_000, littleEndianInt(wav, 24))
        assertEquals(32_000, littleEndianInt(wav, 28))
        assertEquals(4, littleEndianInt(wav, 40))
        assertArrayEquals(pcm, wav.copyOfRange(44, wav.size))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsInvalidSampleRate() {
        PcmWav.encode(byteArrayOf(), sampleRate = 0)
    }

    private fun littleEndianInt(bytes: ByteArray, offset: Int): Int =
        (bytes[offset].toInt() and 0xff) or
            ((bytes[offset + 1].toInt() and 0xff) shl 8) or
            ((bytes[offset + 2].toInt() and 0xff) shl 16) or
            ((bytes[offset + 3].toInt() and 0xff) shl 24)
}
