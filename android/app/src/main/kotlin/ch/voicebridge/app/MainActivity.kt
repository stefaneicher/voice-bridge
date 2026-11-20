package ch.voicebridge.app

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.accessibilityservice.AccessibilityServiceInfo
import android.view.accessibility.AccessibilityManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.MutableStateFlow
import ch.voicebridge.app.ui.MainScreen
import ch.voicebridge.app.ui.PairingScreen
import ch.voicebridge.app.ui.PermissionHint
import ch.voicebridge.app.ui.DictationScreen
import ch.voicebridge.app.ui.VoiceBridgeTheme
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()
    private val setupStatus = MutableStateFlow(DictationSetupStatus())
    private val apiKeyStore by lazy { AndroidApiKeyStore(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        refreshSetupStatus()
        enableEdgeToEdge()
        setContent {
            VoiceBridgeTheme {
                val state by vm.state.collectAsStateWithLifecycle()
                val dictationState by DictationRuntime.state.collectAsStateWithLifecycle()
                val setup by setupStatus.collectAsStateWithLifecycle()
                var pcMode by remember { mutableStateOf(false) }
                val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                    refreshSetupStatus()
                }
                val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                    refreshSetupStatus()
                }
                val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
                    if (result.contents != null) vm.onQrScanned(result.contents)
                }
                when {
                    !pcMode -> DictationScreen(
                        state = dictationState,
                        supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU,
                        microphoneGranted = setup.microphoneGranted,
                        overlayPermission = setup.overlayPermission,
                        accessibilityEnabled = setup.accessibilityEnabled,
                        notificationsGranted = setup.notificationsGranted,
                        apiKeyStored = setup.apiKeyStored,
                        setupError = setup.error,
                        onSaveApiKey = ::saveApiKey,
                        onDeleteApiKey = ::deleteApiKey,
                        onOpenApiKeyPage = ::openApiKeyPage,
                        onRequestMicrophone = { micPermission.launch(Manifest.permission.RECORD_AUDIO) },
                        onRequestOverlay = {
                            startActivity(
                                Intent(
                                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    Uri.parse("package:$packageName"),
                                ),
                            )
                        },
                        onRequestAccessibility = ::openAccessibilitySettings,
                        onRequestNotifications = {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                            }
                        },
                        onEnableOverlay = { DictationForegroundService.enable(this) },
                        onDisableOverlay = { DictationForegroundService.disable(this) },
                        onStartTest = { DictationForegroundService.startTest(this) },
                        onStopRecording = { DictationForegroundService.stopRecording(this) },
                        onSendAudio = { DictationForegroundService.send(this) },
                        onDiscard = { DictationForegroundService.discard(this) },
                        onOpenPcMode = { pcMode = true },
                    )
                    state.connection == Connection.Unpaired || state.pairingError != null && state.connection !is Connection.Connected ->
                        PairingScreen(
                            error = state.pairingError,
                            connecting = state.connection == Connection.Connecting,
                            onScan = {
                                scanner.launch(
                                    ScanOptions()
                                        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                                        .setPrompt(getString(R.string.scan_prompt))
                                        .setBeepEnabled(false)
                                        .setOrientationLocked(false),
                                )
                            },
                            onLink = vm::onQrScanned,
                            onOpenDictation = { pcMode = false },
                        )
                    !setup.microphoneGranted -> PermissionHint(
                        onRequest = { micPermission.launch(Manifest.permission.RECORD_AUDIO) },
                        onOpenDictation = { pcMode = false },
                    )
                    else -> MainScreen(
                        state = state,
                        onSelect = vm::select,
                        onPress = vm::startRecording,
                        onRelease = vm::stopRecording,
                        onReconnect = vm::reconnect,
                        onUnpair = vm::unpair,
                        onDismiss = vm::dismissOutcome,
                        onOpenDictation = { pcMode = false },
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.reconnect()
        refreshSetupStatus()
    }

    override fun onStop() {
        super.onStop()
        // Never keep recording in the background.
        vm.stopRecording()
    }

    private fun saveApiKey(value: String) {
        try {
            apiKeyStore.save(value)
            refreshSetupStatus()
        } catch (error: Exception) {
            refreshSetupStatus(error.message ?: "API-Schlüssel konnte nicht gespeichert werden.")
        }
    }

    private fun deleteApiKey() {
        try {
            apiKeyStore.delete()
            refreshSetupStatus()
        } catch (error: Exception) {
            refreshSetupStatus(error.message ?: "API-Schlüssel konnte nicht gelöscht werden.")
        }
    }

    private fun openApiKeyPage() {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://platform.openai.com/api-keys")))
        } catch (_: ActivityNotFoundException) {
            refreshSetupStatus("Kein Browser zum Öffnen der OpenAI-Schlüssel-Seite verfügbar.")
        }
    }

    private fun refreshSetupStatus(errorOverride: String? = null) {
        var stored = false
        var error = errorOverride
        try {
            stored = apiKeyStore.load() != null
        } catch (failure: Exception) {
            if (error == null) error = failure.message ?: "Gespeicherter API-Schlüssel ist nicht lesbar."
        }
        val accessibilityEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val accessibilityManager = getSystemService(ACCESSIBILITY_SERVICE) as AccessibilityManager
            val component = ComponentName(this, DictationAccessibilityService::class.java)
            accessibilityManager
                .getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)
                .any {
                    ComponentName(
                        it.resolveInfo.serviceInfo.packageName,
                        it.resolveInfo.serviceInfo.name,
                    ) == component
                }
        } else {
            false
        }
        setupStatus.value = DictationSetupStatus(
            microphoneGranted = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
            overlayPermission = Settings.canDrawOverlays(this),
            accessibilityEnabled = accessibilityEnabled,
            notificationsGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
            apiKeyStored = stored,
            error = error,
        )
    }

    private fun openAccessibilitySettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val component = ComponentName(this, DictationAccessibilityService::class.java)
        packageManager.setComponentEnabledSetting(
            component,
            PackageManager.COMPONENT_ENABLED_STATE_ENABLED,
            PackageManager.DONT_KILL_APP,
        )
        startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    private data class DictationSetupStatus(
        val microphoneGranted: Boolean = false,
        val overlayPermission: Boolean = false,
        val accessibilityEnabled: Boolean = false,
        val notificationsGranted: Boolean = false,
        val apiKeyStored: Boolean = false,
        val error: String? = null,
    )
}
