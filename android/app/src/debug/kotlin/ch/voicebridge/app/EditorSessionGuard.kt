package ch.voicebridge.app

data class EditorIdentity(
    val packageName: String?,
    val fieldId: Int,
    val inputType: Int,
    val imeOptions: Int,
)

data class EditorSessionToken internal constructor(
    internal val generation: Long,
    internal val identity: EditorIdentity,
)

/** A delayed insert is valid only for the exact IME editor session that requested it. */
class EditorSessionGuard {
    private var generation = 0L
    private var identity: EditorIdentity? = null

    fun onStartInput(identity: EditorIdentity): EditorSessionToken {
        generation += 1
        this.identity = identity
        return EditorSessionToken(generation, identity)
    }

    fun onFinishInput() {
        generation += 1
        identity = null
    }

    fun currentToken(): EditorSessionToken? = identity?.let {
        EditorSessionToken(generation, it)
    }

    fun isCurrent(token: EditorSessionToken, currentIdentity: EditorIdentity?): Boolean =
        token.generation == generation && token.identity == identity && currentIdentity == identity

}
