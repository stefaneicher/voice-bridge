package ch.voicebridge.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Must match src/remote/protocol.ts on the PC. */
class WireTest {
    @Test
    fun encodesAppMessagesLikeThePcExpects() {
        assertEquals("""{"t":"start","mode":"agent","target":"pty:1"}""", Wire.encode(AppMessage.Start(Mode.AGENT, "pty:1")))
        assertEquals("""{"t":"start","mode":"dictate"}""", Wire.encode(AppMessage.Start(Mode.DICTATE)))
        assertEquals("""{"t":"hello","v":1,"deviceId":"d","token":"x"}""", Wire.encode(AppMessage.Hello(deviceId = "d", token = "x")))
        assertEquals("""{"t":"stop"}""", Wire.encode(AppMessage.Stop))
    }

    @Test
    fun decodesPcMessages() {
        assertEquals(PcMessage.Welcome("PC", "privat"), Wire.decode("""{"t":"welcome","pc":"PC","profile":"privat"}"""))
        val targets = Wire.decode("""{"t":"targets","sessions":[{"id":"pty:1","name":"billing","state":"busy"}]}""")
        assertEquals(PcMessage.Targets(listOf(Target("pty:1", "billing", null, "busy"))), targets)
        val failed = Wire.decode("""{"t":"result","ok":false,"kind":"session-gone","message":"weg","text":"Hallo"}""")
        assertEquals(PcMessage.Result(ok = false, kind = "session-gone", message = "weg", text = "Hallo"), failed)
        assertTrue(Wire.decode("""{"t":"pong"}""") is PcMessage.Pong)
    }

    @Test
    fun ignoresUnknownMessagesAndFields() {
        assertNull(Wire.decode("""{"t":"future"}"""))
        assertNull(Wire.decode("garbage"))
        assertEquals(PcMessage.Status("working", "x"), Wire.decode("""{"t":"status","phase":"working","label":"x","extra":1}"""))
    }

    @Test
    fun computesAudioLevel() {
        assertEquals(0f, AudioCapture.level(ByteArray(0), 0))
        val loud = ByteArray(640) { if (it % 2 == 1) 0x40 else 0 } // 0x4000 = half scale
        assertEquals(1f, AudioCapture.level(loud, loud.size))
    }
}
