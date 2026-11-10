package ch.voicebridge.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingInfoTest {
    // Same URI as produced by pairingUri() in src/remote/protocol.ts.
    private val fp = "ab".repeat(32)

    @Test
    fun parsesTheQrCodeOfThePc() {
        val info = PairingInfo.parse("voicebridge://pair?v=1&h=192.168.1.20%2C10.0.0.5&p=47613&fp=$fp&c=c0de&n=B%C3%BCro-PC")!!
        assertEquals(listOf("192.168.1.20", "10.0.0.5"), info.hosts)
        assertEquals(47613, info.port)
        assertEquals(fp, info.fingerprint)
        assertEquals("c0de", info.code)
        assertEquals("Büro-PC", info.pc)
    }

    @Test
    fun rejectsOtherCodes() {
        assertNull(PairingInfo.parse("https://example.com"))
        assertNull(PairingInfo.parse("voicebridge://pair?h=1.2.3.4&p=1&fp=zz&c=x"))
        assertNull(PairingInfo.parse("voicebridge://pair?h=&p=47613&fp=$fp&c=x"))
        assertNull(PairingInfo.parse("voicebridge://pair?h=1.2.3.4&p=99999&fp=$fp&c=x"))
        assertNull(PairingInfo.parse("not a uri at all %%%"))
    }
}
