package app.glbandme.core.sculpt

/** Reversible editor action. Executed under the scene lock by the caller. */
interface UndoAction {
    val label: String
    fun undo()
    fun redo()
    /** Rough memory footprint, used to cap history size. */
    val bytes: Long get() = 256
}

class LambdaAction(override val label: String, private val doUndo: () -> Unit, private val doRedo: () -> Unit, override val bytes: Long = 256) : UndoAction {
    override fun undo() = doUndo()
    override fun redo() = doRedo()
}

class UndoManager(var maxSteps: Int = 60, var maxBytes: Long = 256L * 1024 * 1024) {
    private val undoStack = ArrayDeque<UndoAction>()
    private val redoStack = ArrayDeque<UndoAction>()
    var onChanged: (() -> Unit)? = null

    val canUndo get() = undoStack.isNotEmpty()
    val canRedo get() = redoStack.isNotEmpty()
    val undoLabel get() = undoStack.lastOrNull()?.label
    val redoLabel get() = redoStack.lastOrNull()?.label

    /** Record an action that has already been applied. */
    fun push(a: UndoAction) {
        undoStack.addLast(a)
        redoStack.clear()
        trim()
        onChanged?.invoke()
    }

    fun undo(): String? {
        val a = undoStack.removeLastOrNull() ?: return null
        a.undo()
        redoStack.addLast(a)
        onChanged?.invoke()
        return a.label
    }

    fun redo(): String? {
        val a = redoStack.removeLastOrNull() ?: return null
        a.redo()
        undoStack.addLast(a)
        onChanged?.invoke()
        return a.label
    }

    fun clear() { undoStack.clear(); redoStack.clear(); onChanged?.invoke() }

    /** Remove the most recent action without undoing it (to merge composite operations). */
    fun popLast(): UndoAction? = undoStack.removeLastOrNull()

    private fun trim() {
        while (undoStack.size > maxSteps) undoStack.removeFirst()
        var total = undoStack.sumOf { it.bytes }
        while (total > maxBytes && undoStack.size > 1) total -= undoStack.removeFirst().bytes
    }
}
