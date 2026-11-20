package ch.voicebridge.app

import android.text.InputType

internal fun Int.isTextInput(): Boolean =
    this and InputType.TYPE_MASK_CLASS == InputType.TYPE_CLASS_TEXT

internal fun Int.isPasswordInput(): Boolean {
    val inputClass = this and InputType.TYPE_MASK_CLASS
    val variation = this and InputType.TYPE_MASK_VARIATION
    return (inputClass == InputType.TYPE_CLASS_TEXT &&
        (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) ||
        (inputClass == InputType.TYPE_CLASS_NUMBER &&
            variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
}
