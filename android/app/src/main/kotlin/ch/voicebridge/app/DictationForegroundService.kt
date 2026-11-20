package ch.voicebridge.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class DictationForegroundService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val keyStore by lazy { AndroidApiKeyStore(this) }
    private var windowManager: WindowManager? = null
    private var overlay: TextView? = null
    private var capture: AudioCapture? = null
    private var pcmBuffer: ByteArrayOutputStream? = null
    private var pendingAudio: ByteArray? = null
    private var editorToken: EditorSessionToken? = null
    private var recordingFailure: String? = null
    private var recordingTimer: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        runningService = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_ENABLE -> enableOverlay()
            ACTION_START_TEST -> startRecording(testLab = true)
            ACTION_TOGGLE -> when (DictationRuntime.state.value.phase) {
                DictationPhase.READY -> startRecording(testLab = false)
                DictationPhase.RECORDING -> stopRecording()
                DictationPhase.AWAITING_CONSENT -> sendToOpenAi()
                DictationPhase.ERROR -> if (pendingAudio != null) sendToOpenAi() else openApp()
                DictationPhase.RESULT -> openApp()
                DictationPhase.TRANSCRIBING, DictationPhase.DISABLED -> Unit
            }
            ACTION_STOP_RECORDING -> stopRecording()
            ACTION_SEND -> sendToOpenAi()
            ACTION_DISCARD -> discardPendingData()
            ACTION_DISABLE -> disableOverlay()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        recordingTimer?.cancel()
        val overlayWasEnabled = DictationRuntime.state.value.overlayEnabled
        removeOverlay()
        serviceScope.cancel()
        if (runningService === this) runningService = null
        if (overlayWasEnabled) {
            setState(DictationUiState(phase = DictationPhase.DISABLED, message = "Overlay ist ausgeschaltet."))
        }
        super.onDestroy()
    }

    private fun enableOverlay() {
        try {
            startAsForeground()
        } catch (_: SecurityException) {
            setState(DictationUiState(phase = DictationPhase.ERROR, message = "Mikrofon- oder Benachrichtigungsfreigabe fehlt."))
            stopSelf()
            return
        }
        if (!Settings.canDrawOverlays(this)) {
            setState(DictationUiState(phase = DictationPhase.ERROR, message = "Die Overlay-Freigabe fehlt."))
            stopSelf()
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            setState(DictationUiState(phase = DictationPhase.ERROR, message = "Einfügen benötigt Android 13 oder neuer."))
            stopSelf()
            return
        }
        if (!createOverlay()) {
            stopSelf()
            return
        }
        setState(DictationUiState(phase = DictationPhase.READY, message = "Overlay bereit."))
    }

    private fun startAsForeground() {
        createNotificationChannel()
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification("Overlay wird gestartet. · Keine Aufnahme"), foregroundServiceType())
    }

    private fun buildNotification(status: String): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_mic)
            .setContentTitle("Voice-Bridge-Diktat")
            .setContentText(status)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setOngoing(true)
            .setContentIntent(
                PendingIntent.getActivity(
                    this,
                    0,
                    Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .build()

    private fun foregroundServiceType(): Int {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            0
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Diktat-Overlay", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Zeigt an, dass das Diktat-Overlay aktiv ist."
                lockscreenVisibility = Notification.VISIBILITY_PRIVATE
            },
        )
    }

    private fun createOverlay(): Boolean {
        if (overlay != null) return true
        val manager = getSystemService(WINDOW_SERVICE) as WindowManager
        val view = TextView(this).apply {
            text = "Diktat"
            setTextColor(Color.WHITE)
            textSize = 14f
            gravity = Gravity.CENTER
            contentDescription = "Voice-Bridge-Diktat. Antippen zum Starten."
            setPadding(dp(18), dp(12), dp(18), dp(12))
            background = GradientDrawable().apply {
                setColor(0xFF15151C.toInt())
                cornerRadius = dp(28).toFloat()
                setStroke(dp(1), 0xFF2AA5A1.toInt())
            }
        }
        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = getSharedPreferences(PREFERENCES, MODE_PRIVATE).getInt(POSITION_X, dp(18))
            y = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
                .getInt(POSITION_Y, resources.displayMetrics.heightPixels * 2 / 3)
        }
        try {
            view.setOnClickListener { handleOverlayTap() }
            view.setOnTouchListener(OverlayDragListener(view, manager, params) { x, y ->
                getSharedPreferences(PREFERENCES, MODE_PRIVATE).edit()
                    .putInt(POSITION_X, x)
                    .putInt(POSITION_Y, y)
                    .apply()
            })
            manager.addView(view, params)
            windowManager = manager
            overlay = view
            return true
        } catch (_: SecurityException) {
            setState(DictationUiState(phase = DictationPhase.ERROR, message = "Overlay konnte nicht angezeigt werden. Prüfe die Systemfreigabe."))
            return false
        }
    }

    private fun removeOverlay() {
        val view = overlay ?: return
        windowManager?.removeView(view)
        overlay = null
        windowManager = null
    }

    private fun handleOverlayTap() {
        when (DictationRuntime.state.value.phase) {
            DictationPhase.READY -> startRecording(testLab = false)
            DictationPhase.RECORDING -> stopRecording()
            DictationPhase.AWAITING_CONSENT -> sendToOpenAi()
            DictationPhase.ERROR -> if (pendingAudio != null) sendToOpenAi() else openApp()
            DictationPhase.RESULT -> openApp()
            DictationPhase.TRANSCRIBING, DictationPhase.DISABLED -> Unit
        }
    }

    private fun startRecording(testLab: Boolean) {
        if (DictationRuntime.state.value.phase != DictationPhase.READY) return
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            setState(DictationUiState(phase = DictationPhase.ERROR, message = "Mikrofonfreigabe fehlt."))
            return
        }
        val token = if (testLab) null else DictationAccessibilityService.currentWritableSession()
        if (!testLab && token == null) {
            setState(
                DictationUiState(
                    phase = DictationPhase.ERROR,
                    message = "Kein unterstütztes Textfeld aktiv oder Passwortfeld erkannt. Text bleibt unverändert.",
                ),
            )
            return
        }

        val buffer = ByteArrayOutputStream()
        val recorder = AudioCapture(
            onFrame = { bytes, length, _ -> buffer.write(bytes, 0, length) },
            onFailure = { message ->
                serviceScope.launch {
                    if (DictationRuntime.state.value.phase == DictationPhase.RECORDING) {
                        recordingFailure = message
                        stopRecording()
                    }
                }
            },
        )
        if (!recorder.start(serviceScope)) {
            setState(DictationUiState(phase = DictationPhase.ERROR, message = "Mikrofon konnte nicht gestartet werden."))
            return
        }
        pcmBuffer = buffer
        capture = recorder
        editorToken = token
        recordingFailure = null
        setState(
            DictationUiState(
                phase = DictationPhase.RECORDING,
                message = if (testLab) "Testaufnahme läuft · zum Stoppen antippen." else "Aufnahme läuft · zum Stoppen antippen.",
                testLab = testLab,
            ),
        )
        recordingTimer?.cancel()
        recordingTimer = serviceScope.launch {
            delay(MAX_RECORDING_MS)
            if (DictationRuntime.state.value.phase == DictationPhase.RECORDING) stopRecording()
        }
    }

    private fun stopRecording() {
        if (DictationRuntime.state.value.phase != DictationPhase.RECORDING) return
        recordingTimer?.cancel()
        val recorder = capture ?: return
        val testLab = DictationRuntime.state.value.testLab
        val failure = recordingFailure
        recordingFailure = null
        setState(DictationUiState(phase = DictationPhase.TRANSCRIBING, message = "Aufnahme wird abgeschlossen …", testLab = testLab))
        serviceScope.launch {
            recorder.stop()
            capture = null
            val pcm = pcmBuffer?.toByteArray() ?: ByteArray(0)
            pcmBuffer = null
            if (pcm.isEmpty()) {
                editorToken = null
                setState(
                    DictationUiState(
                        phase = DictationPhase.ERROR,
                        message = failure ?: "Keine Audiodaten aufgenommen.",
                        testLab = testLab,
                    ),
                )
                return@launch
            }
            pendingAudio = PcmWav.encode(pcm)
            setState(
                DictationUiState(
                    phase = DictationPhase.AWAITING_CONSENT,
                    message = if (failure != null) {
                        "$failure Verfügbare Teilaufnahme bleibt erhalten; antippen, um sie an OpenAI zu senden."
                    } else if (testLab) {
                        "Testaufnahme bereit · antippen, um Audio an OpenAI zu senden."
                    } else {
                        "Fertig · antippen, um Audio an OpenAI zu senden."
                    },
                    audioAvailable = true,
                    testLab = testLab,
                ),
            )
        }
    }

    private fun sendToOpenAi() {
        val state = DictationRuntime.state.value
        if (state.phase != DictationPhase.AWAITING_CONSENT && !(state.phase == DictationPhase.ERROR && pendingAudio != null)) return
        val audio = pendingAudio ?: run {
            setState(state.copy(phase = DictationPhase.ERROR, message = "Aufnahme nicht mehr verfügbar."))
            return
        }
        setState(state.copy(phase = DictationPhase.TRANSCRIBING, message = "Sende Aufnahme verschlüsselt an OpenAI …"))
        serviceScope.launch {
            try {
                val key = keyStore.load() ?: throw IllegalStateException("Kein OpenAI-API-Schlüssel hinterlegt.")
                val text = OpenAiTranscriber().transcribe(audio, key)
                pendingAudio = null
                if (text.isEmpty()) {
                    editorToken = null
                    setState(DictationUiState(phase = DictationPhase.RESULT, message = "Kein Text erkannt. Aufnahme verworfen.", testLab = state.testLab))
                    return@launch
                }
                if (state.testLab) {
                    editorToken = null
                    setState(DictationUiState(phase = DictationPhase.RESULT, message = "Transkription im Testlabor · nicht eingefügt.", text = text, testLab = true))
                    return@launch
                }
                val token = editorToken
                editorToken = null
                val inserted = token != null && DictationAccessibilityService.insert(token, text)
                if (inserted) {
                    setState(DictationUiState(phase = DictationPhase.RESULT, message = "Einfügeaufruf gesendet · Zielfeld bitte prüfen.", text = text))
                } else {
                    setState(
                        DictationUiState(
                            phase = DictationPhase.ERROR,
                            message = "Zielfeld gewechselt oder Einfügen nicht verfügbar. Text bleibt erhalten und wurde nicht umgeleitet.",
                            text = text,
                        ),
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                val message = when (error) {
                    is OpenAiHttpException -> error.message ?: "OpenAI-Anfrage fehlgeschlagen."
                    is IllegalStateException -> error.message ?: "Diktat ist nicht bereit."
                    is java.io.IOException -> error.message ?: "Transkription fehlgeschlagen."
                    else -> "Transkription fehlgeschlagen. Prüfe Internetverbindung und API-Schlüssel."
                }
                setState(
                    DictationUiState(
                        phase = DictationPhase.ERROR,
                        message = message,
                        audioAvailable = pendingAudio != null,
                        testLab = state.testLab,
                    ),
                )
            }
        }
    }

    private fun discardPendingData() {
        if (DictationRuntime.state.value.phase == DictationPhase.RECORDING) return
        pendingAudio = null
        editorToken = null
        pcmBuffer = null
        if (overlay != null) {
            setState(DictationUiState(phase = DictationPhase.READY, message = "Overlay bereit."))
        } else {
            setState(DictationUiState(phase = DictationPhase.DISABLED, message = "Overlay ist ausgeschaltet."))
        }
    }

    private fun disableOverlay() {
        val state = DictationRuntime.state.value
        if (state.audioAvailable || state.text != null || state.phase == DictationPhase.RECORDING || state.phase == DictationPhase.TRANSCRIBING) {
            setState(state.copy(message = "Bitte Ergebnis kopieren oder ausdrücklich verwerfen, bevor das Overlay ausgeschaltet wird."))
            return
        }
        removeOverlay()
        stopForeground(STOP_FOREGROUND_REMOVE)
        setState(DictationUiState(phase = DictationPhase.DISABLED, message = "Overlay ist ausgeschaltet."))
        stopSelf()
    }

    private fun openApp() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
    }

    private fun setState(state: DictationUiState) {
        val current = state.copy(overlayEnabled = overlay != null)
        DictationRuntime.update(current)
        if (overlay != null) {
            val notificationText = when (current.phase) {
                DictationPhase.DISABLED -> "Overlay ausgeschaltet"
                DictationPhase.READY -> "Overlay aktiv · Aufnahme nur nach Antippen"
                DictationPhase.RECORDING -> "Aufnahme läuft"
                DictationPhase.AWAITING_CONSENT -> "Aufnahme bereit · Upload nur nach deiner Zustimmung"
                DictationPhase.TRANSCRIBING -> "Verarbeitung läuft"
                DictationPhase.RESULT -> "Ergebnis bereit · Zielfeld prüfen"
                DictationPhase.ERROR -> "Problem beim Diktat · Text oder Audio bleibt erhalten"
            }
            getSystemService(NotificationManager::class.java).notify(
                NOTIFICATION_ID,
                buildNotification(notificationText),
            )
        }
        val label = when (current.phase) {
            DictationPhase.DISABLED -> "Diktat"
            DictationPhase.READY -> "Diktat"
            DictationPhase.RECORDING -> "Aufnahme stoppen"
            DictationPhase.AWAITING_CONSENT -> if (current.testLab) "Cloud-Test senden" else "An OpenAI senden"
            DictationPhase.TRANSCRIBING -> "Verarbeite …"
            DictationPhase.RESULT -> "Ergebnis anzeigen"
            DictationPhase.ERROR -> if (current.audioAvailable) "Erneut an OpenAI senden" else "Ergebnis anzeigen"
        }
        overlay?.apply {
            text = label
            contentDescription = current.message
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private inner class OverlayDragListener(
        private val view: View,
        private val manager: WindowManager,
        private val params: WindowManager.LayoutParams,
        private val onPositionChanged: (Int, Int) -> Unit,
    ) : View.OnTouchListener {
        private val touchSlop = android.view.ViewConfiguration.get(this@DictationForegroundService).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var startX = 0
        private var startY = 0
        private var dragging = false

        override fun onTouch(view: View, event: MotionEvent): Boolean {
            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    downX = event.rawX
                    downY = event.rawY
                    startX = params.x
                    startY = params.y
                    dragging = false
                    return true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - downX).toInt()
                    val dy = (event.rawY - downY).toInt()
                    if (!dragging && (kotlin.math.abs(dx) > touchSlop || kotlin.math.abs(dy) > touchSlop)) dragging = true
                    if (dragging) {
                        params.x = (startX + dx).coerceIn(0, (resources.displayMetrics.widthPixels - view.width).coerceAtLeast(0))
                        params.y = (startY + dy).coerceIn(0, (resources.displayMetrics.heightPixels - view.height).coerceAtLeast(0))
                        manager.updateViewLayout(view, params)
                    }
                    return true
                }
                MotionEvent.ACTION_UP -> {
                    if (dragging) {
                        onPositionChanged(params.x, params.y)
                    } else {
                        view.performClick()
                    }
                    return true
                }
                MotionEvent.ACTION_CANCEL -> return true
            }
            return false
        }
    }

    companion object {
        @Volatile
        private var runningService: DictationForegroundService? = null

        internal fun editorSessionChanged() {
            val service = runningService ?: return
            service.serviceScope.launch {
                val token = service.editorToken
                if (DictationRuntime.state.value.phase == DictationPhase.RECORDING &&
                    token != null &&
                    !DictationAccessibilityService.isCurrent(token)
                ) {
                    service.recordingFailure = "Zielfeld gewechselt. Aufnahme gestoppt und nicht gesendet."
                    service.stopRecording()
                }
            }
        }

        private const val ACTION_ENABLE = "ch.voicebridge.app.action.ENABLE_DICTATION"
        private const val ACTION_START_TEST = "ch.voicebridge.app.action.START_TEST"
        private const val ACTION_TOGGLE = "ch.voicebridge.app.action.TOGGLE_DICTATION"
        private const val ACTION_STOP_RECORDING = "ch.voicebridge.app.action.STOP_RECORDING"
        private const val ACTION_SEND = "ch.voicebridge.app.action.SEND_AUDIO"
        private const val ACTION_DISCARD = "ch.voicebridge.app.action.DISCARD_PENDING"
        private const val ACTION_DISABLE = "ch.voicebridge.app.action.DISABLE_DICTATION"
        const val CHANNEL_ID = "dictation_overlay"
        const val NOTIFICATION_ID = 4813
        const val MAX_RECORDING_MS = 8 * 60 * 1_000L
        const val PREFERENCES = "dictation_overlay"
        const val POSITION_X = "position_x"
        const val POSITION_Y = "position_y"

        fun start(context: Context, action: String) {
            val intent = Intent(context, DictationForegroundService::class.java).setAction(action)
            ContextCompat.startForegroundService(context, intent)
        }

        fun enable(context: Context) = start(context, ACTION_ENABLE)

        fun startTest(context: Context) = start(context, ACTION_START_TEST)

        fun toggle(context: Context) = start(context, ACTION_TOGGLE)

        fun stopRecording(context: Context) = start(context, ACTION_STOP_RECORDING)

        fun send(context: Context) = start(context, ACTION_SEND)

        fun discard(context: Context) = start(context, ACTION_DISCARD)

        fun disable(context: Context) = start(context, ACTION_DISABLE)
    }
}
