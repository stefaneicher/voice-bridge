package ch.voicebridge.app

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import kotlin.math.sqrt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/** Records 16 kHz mono PCM16 in 20 ms frames. Nothing is written to storage. */
class AudioCapture(private val onFrame: (bytes: ByteArray, length: Int, level: Float) -> Unit) {
    private var job: Job? = null
    @Volatile private var running = false

    /** Requires the RECORD_AUDIO permission. Returns false if the microphone is unavailable. */
    @SuppressLint("MissingPermission")
    fun start(scope: CoroutineScope): Boolean {
        if (running) return true
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL, ENCODING)
        if (minBuffer <= 0) return false
        val recorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            SAMPLE_RATE,
            CHANNEL,
            ENCODING,
            maxOf(minBuffer, FRAME_BYTES * 8),
        )
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder.release()
            return false
        }
        running = true
        recorder.startRecording()
        job = scope.launch(Dispatchers.IO) {
            val buffer = ByteArray(FRAME_BYTES)
            try {
                while (running && isActive) {
                    val n = recorder.read(buffer, 0, buffer.size)
                    if (n > 0) onFrame(buffer, n, level(buffer, n))
                }
            } finally {
                recorder.stop()
                recorder.release()
            }
        }
        return true
    }

    /** Stops after the current frame and waits until the last frame was delivered. */
    suspend fun stop() {
        running = false
        job?.join()
        job = null
    }

    companion object {
        private const val CHANNEL = AudioFormat.CHANNEL_IN_MONO
        private const val ENCODING = AudioFormat.ENCODING_PCM_16BIT
        const val FRAME_BYTES = SAMPLE_RATE / 50 * 2 // 20 ms

        /** RMS of little-endian PCM16, scaled to 0..1 for the level meter. */
        fun level(bytes: ByteArray, length: Int): Float {
            val samples = length / 2
            if (samples == 0) return 0f
            var sum = 0.0
            for (i in 0 until samples) {
                val s = (bytes[2 * i].toInt() and 0xff) or (bytes[2 * i + 1].toInt() shl 8)
                val v = s.toShort() / 32768.0
                sum += v * v
            }
            return (sqrt(sum / samples) * 4).coerceAtMost(1.0).toFloat()
        }
    }
}
