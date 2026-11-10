package ch.voicebridge.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

/** Colours of stefaneicher.github.io / Disroop (docs/ui-spec.md, ADR-014). */
object VB {
    val Ink = Color(0xFF15151C)
    val Ink2 = Color(0xFF1D1D27)
    val Ink3 = Color(0xFF24242F)
    val Line = Color(0xFF2E2E3B)
    val Text = Color(0xFFEDF6F3)
    val Text2 = Color(0xFFC6CAD3)
    val Text3 = Color(0xFF9A9CAB)
    /** Dictate accent. */
    val Teal = Color(0xFF2AA5A1)
    /** Agent accent. */
    val Lime = Color(0xFFA3D858)
    val Blue = Color(0xFF245E71)
    val OnAccent = Color(0xFF0D1716)
    val Rec = Color(0xFFFF5A5F)
}

@Composable
fun VoiceBridgeTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = VB.Teal,
            onPrimary = VB.OnAccent,
            secondary = VB.Lime,
            onSecondary = VB.OnAccent,
            tertiary = VB.Blue,
            background = VB.Ink,
            onBackground = VB.Text,
            surface = VB.Ink2,
            onSurface = VB.Text,
            surfaceVariant = VB.Ink3,
            onSurfaceVariant = VB.Text2,
            error = VB.Rec,
            outline = VB.Line,
        ),
        content = content,
    )
}
