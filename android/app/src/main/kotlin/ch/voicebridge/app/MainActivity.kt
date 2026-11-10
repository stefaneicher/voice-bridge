package ch.voicebridge.app

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
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
import ch.voicebridge.app.ui.MainScreen
import ch.voicebridge.app.ui.PairingScreen
import ch.voicebridge.app.ui.PermissionHint
import ch.voicebridge.app.ui.VoiceBridgeTheme
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            VoiceBridgeTheme {
                val state by vm.state.collectAsStateWithLifecycle()
                var micGranted by remember { mutableStateOf(hasMic()) }
                val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
                    micGranted = it
                }
                val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
                    if (result.contents != null) vm.onQrScanned(result.contents)
                }
                when {
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
                        )
                    !micGranted -> PermissionHint { micPermission.launch(Manifest.permission.RECORD_AUDIO) }
                    else -> MainScreen(
                        state = state,
                        onSelect = vm::select,
                        onPress = vm::startRecording,
                        onRelease = vm::stopRecording,
                        onReconnect = vm::reconnect,
                        onUnpair = vm::unpair,
                        onDismiss = vm::dismissOutcome,
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        vm.reconnect()
    }

    override fun onStop() {
        super.onStop()
        // Never keep recording in the background.
        vm.stopRecording()
    }

    private fun hasMic() =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
}
