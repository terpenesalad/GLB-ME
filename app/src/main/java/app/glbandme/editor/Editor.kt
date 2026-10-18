package app.glbandme.editor

import app.glbandme.core.edit.FaceSelection
import app.glbandme.core.mesh.Decimator
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.sculpt.BrushSettings
import app.glbandme.core.sculpt.BrushType
import app.glbandme.core.sculpt.LambdaAction
import app.glbandme.core.sculpt.SculptEngine
import app.glbandme.core.sculpt.UndoManager
import app.glbandme.math.Mat4
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import app.glbandme.ui.Icon
import java.util.EnumMap

enum class Tool(val label: String, val icon: Icon, val brush: BrushType? = null) {
    TRANSFORM("Transform", Icon.MOVE),
    SELECT("Select", Icon.SELECT),
    CLAY("Clay", Icon.CLAY, BrushType.CLAY),
    DRAW("Draw", Icon.DRAW, BrushType.DRAW),
    INFLATE("Inflate", Icon.INFLATE, BrushType.INFLATE),
    SMOOTH("Smooth", Icon.SMOOTH, BrushType.SMOOTH),
    FLATTEN("Flatten", Icon.FLATTEN, BrushType.FLATTEN),
    PINCH("Pinch", Icon.PINCH, BrushType.PINCH),
    CREASE("Crease", Icon.CREASE, BrushType.CREASE),
    MOVE("Move", Icon.GRAB, BrushType.MOVE),
    DRAG("Drag", Icon.DRAG, BrushType.DRAG),
    LAYER("Layer", Icon.LAYER, BrushType.LAYER),
    MASK("Mask", Icon.MASK, BrushType.MASK),
    PAINT("Paint", Icon.PAINT, BrushType.PAINT);

    val isBrush get() = brush != null
}

enum class GizmoMode(val label: String, val icon: Icon) { MOVE("Move", Icon.MOVE), ROTATE("Rotate", Icon.ROTATE), SCALE("Scale", Icon.SCALE) }

/** What changed, so UI parts can refresh selectively. */
enum class Change { SELECTION, OBJECTS, TRANSFORM, MATERIAL, TOPOLOGY, RENDER, TOOL, UNDO, ANIMATION, FRAME, EDIT_SELECTION }

/**
 * Editor model/controller. All scene mutations go through here, under synchronized(scene).
 */
class Editor(val scene: Scene) {
    val undo = UndoManager()
    val sculpt = SculptEngine()
    val faces = FaceSelection()
    var tool = Tool.CLAY; private set
    var gizmoMode = GizmoMode.MOVE
    var snap = false
    var autoKey = false
    var playing = false
    var loop = true
    var dirty = false
    var showMask = true
    private val brushSettings = EnumMap<BrushType, BrushSettings>(BrushType::class.java)
    /** Shared paint color (sRGB int) */
    var paintColor = 0xFFE53935.toInt()

    private val listeners = ArrayList<(Set<Change>) -> Unit>()
    var requestRender: () -> Unit = {}

    init {
        for (b in BrushType.values()) brushSettings[b] = BrushSettings().apply {
            when (b) {
                BrushType.SMOOTH -> intensity = 0.6f
                BrushType.MOVE -> { radiusPx = 110f; intensity = 0.8f }
                BrushType.DRAG -> { intensity = 0.7f }
                BrushType.MASK -> intensity = 0.8f
                BrushType.PAINT -> intensity = 0.7f
                BrushType.INFLATE -> intensity = 0.35f
                BrushType.LAYER -> intensity = 0.6f
                else -> {}
            }
        }
        undo.onChanged = { notify(Change.UNDO) }
        if (scene.selected == null) scene.selected = scene.objects.firstOrNull()
        // Sculpt straight away on a lone sculpt base; otherwise start safe with the transform tool
        val only = scene.objects.singleOrNull()
        tool = if (only != null && only.primitive == null && only.name.startsWith("Sculpt")) Tool.CLAY else Tool.TRANSFORM
    }

    fun addListener(l: (Set<Change>) -> Unit) { listeners.add(l) }

    private val mainHandler = android.os.Handler(android.os.Looper.getMainLooper())

    fun notify(vararg c: Change) {
        if (android.os.Looper.myLooper() != android.os.Looper.getMainLooper()) {
            val copy = c.copyOf()
            mainHandler.post { notify(*copy) }
            return
        }
        val set = c.toSet()
        if (Change.UNDO !in set || set.size > 1) dirty = true
        for (l in listeners) l(set)
        requestRender()
    }

    fun brush(t: BrushType): BrushSettings = brushSettings[t]!!
    val currentBrush: BrushSettings? get() = tool.brush?.let { brush(it) }

    /** Symmetry is shared across brushes like in Nomad. */
    fun setSymmetry(axis: Int, on: Boolean) { for (b in brushSettings.values) b.symmetry[axis] = on; notify(Change.TOOL) }
    fun symmetry(axis: Int) = brush(BrushType.CLAY).symmetry[axis]

    fun setTool(t: Tool) {
        tool = t
        if (t == Tool.SELECT) faces.bind(scene.selected?.mesh)
        notify(Change.TOOL)
    }

    inline fun <T> locked(block: () -> T): T = synchronized(scene) { block() }

    // =========================================================================================
    // selection & object list
    // =========================================================================================
    fun select(o: SceneObject?) {
        locked { scene.selected = o }
        if (tool == Tool.SELECT) faces.bind(o?.mesh)
        notify(Change.SELECTION)
    }

    private fun listSnapshot() = ArrayList(scene.objects) to scene.selected

    private fun pushListUndo(label: String, before: Pair<ArrayList<SceneObject>, SceneObject?>) {
        val after = listSnapshot()
        undo.push(LambdaAction(label, {
            locked { scene.objects.clear(); scene.objects.addAll(before.first); scene.selected = before.second }
            notify(Change.OBJECTS, Change.SELECTION)
        }, {
            locked { scene.objects.clear(); scene.objects.addAll(after.first); scene.selected = after.second }
            notify(Change.OBJECTS, Change.SELECTION)
        }))
    }

    fun addObject(o: SceneObject, label: String = "Add ${o.name}") {
        val before = listSnapshot()
        locked { o.name = scene.uniqueName(o.name); scene.add(o) }
        pushListUndo(label, before)
        notify(Change.OBJECTS, Change.SELECTION)
    }

    fun addObjects(objs: List<SceneObject>, label: String) {
        if (objs.isEmpty()) return
        val before = listSnapshot()
        locked { for (o in objs) { o.name = scene.uniqueName(o.name); scene.add(o, select = false) }; scene.selected = objs.first() }
        pushListUndo(label, before)
        notify(Change.OBJECTS, Change.SELECTION)
    }

    fun deleteSelected() {
        val o = scene.selected ?: return
        val before = listSnapshot()
        locked { scene.remove(o) }
        pushListUndo("Delete ${o.name}", before)
        notify(Change.OBJECTS, Change.SELECTION)
    }

    fun duplicateSelected(mirrorAxis: Int = -1) {
        val o = scene.selected ?: return
        val before = listSnapshot()
        val copy = locked {
            val c = o.duplicate()
            if (mirrorAxis >= 0) {
                val m = FloatArray(16); Mat4.identity(m)
                m[mirrorAxis * 5] = -1f
                c.mesh.applyTransform(m)
                c.position[mirrorAxis] = -c.position[mirrorAxis]
                c.primitive = null
                c.name = o.name + " mirror"
            }
            c.name = scene.uniqueName(c.name)
            val i = scene.objects.indexOf(o)
            scene.objects.add(i + 1, c)
            scene.selected = c
            c
        }
        pushListUndo(if (mirrorAxis >= 0) "Mirror ${o.name}" else "Duplicate ${o.name}", before)
        notify(Change.OBJECTS, Change.SELECTION)
        copy.visible = true
    }

    fun moveInList(o: SceneObject, delta: Int) {
        val before = listSnapshot()
        locked {
            val i = scene.objects.indexOf(o)
            val j = (i + delta).coerceIn(0, scene.objects.size - 1)
            if (i == j) return
            scene.objects.removeAt(i); scene.objects.add(j, o)
        }
        pushListUndo("Reorder", before)
        notify(Change.OBJECTS)
    }

    fun setVisible(o: SceneObject, v: Boolean) {
        val old = o.visible
        locked { o.visible = v }
        undo.push(LambdaAction(if (v) "Show ${o.name}" else "Hide ${o.name}", { locked { o.visible = old }; notify(Change.OBJECTS) }, { locked { o.visible = v }; notify(Change.OBJECTS) }))
        notify(Change.OBJECTS)
    }

    fun rename(o: SceneObject, name: String) {
        val old = o.name
        locked { o.name = name }
        undo.push(LambdaAction("Rename", { locked { o.name = old }; notify(Change.OBJECTS) }, { locked { o.name = name }; notify(Change.OBJECTS) }))
        notify(Change.OBJECTS)
    }

    /** Merge all visible mesh objects into the selected one (world transforms baked). */
    fun joinVisible() {
        val target = scene.selected ?: return
        val others = scene.objects.filter { it.visible && it !== target }
        if (others.isEmpty()) return
        val before = listSnapshot()
        val oldMesh = target.mesh
        val oldT = target.currentKeyframe()
        val newMesh = locked {
            val inv = Mat4.inverted(target.localMatrix())
            val parts = ArrayList<Pair<Mesh, FloatArray?>>()
            parts.add(target.mesh to null)
            for (o in others) {
                val m = o.mesh.copy()
                // bake material color into vertex colors so the look survives the merge
                val c = m.ensureColors()
                for (v in 0 until m.vertexCount) for (k in 0 until 3) c[v * 4 + k] *= o.material.baseColor[k]
                parts.add(m to Mat4.mul(inv, o.localMatrix()))
            }
            val tm = target.mesh.copy()
            val tc = tm.ensureColors()
            for (v in 0 until tm.vertexCount) for (k in 0 until 3) tc[v * 4 + k] *= target.material.baseColor[k]
            parts[0] = tm to null
            val merged = app.glbandme.core.mesh.MeshBuilder.merge(parts)
            target.mesh = merged
            target.primitive = null
            scene.objects.removeAll(others.toSet())
            merged
        }
        val oldMat = target.material.copy()
        locked { target.material.baseColor[0] = 1f; target.material.baseColor[1] = 1f; target.material.baseColor[2] = 1f }
        val newMat = target.material.copy()
        val after = listSnapshot()
        undo.push(LambdaAction("Join ${others.size + 1} objects", {
            locked { scene.objects.clear(); scene.objects.addAll(before.first); scene.selected = before.second; target.mesh = oldMesh; target.applyKeyframe(oldT); target.material.copyFrom(oldMat) }
            notify(Change.OBJECTS, Change.TOPOLOGY)
        }, {
            locked { scene.objects.clear(); scene.objects.addAll(after.first); scene.selected = after.second; target.mesh = newMesh; target.material.copyFrom(newMat) }
            notify(Change.OBJECTS, Change.TOPOLOGY)
        }, newMesh.vertexCount * 40L))
        notify(Change.OBJECTS, Change.TOPOLOGY, Change.SELECTION)
    }

    // =========================================================================================
    // transforms
    // =========================================================================================
    fun beginTransform(o: SceneObject): Keyframe = o.currentKeyframe()

    fun commitTransform(o: SceneObject, before: Keyframe, label: String = "Transform") {
        val after = o.currentKeyframe()
        if (before.position == after.position && before.scale == after.scale && before.rotation.toString() == after.rotation.toString()) return
        val frame = scene.currentFrame.toInt()
        val hadKey = o.keys[frame]?.copy()
        val keyed = autoKey
        if (keyed) locked { o.keys[frame] = after.copy() }
        undo.push(LambdaAction(label, {
            locked { o.applyKeyframe(before); if (keyed) { if (hadKey != null) o.keys[frame] = hadKey else o.keys.remove(frame) } }
            notify(Change.TRANSFORM, Change.ANIMATION)
        }, {
            locked { o.applyKeyframe(after); if (keyed) o.keys[frame] = after.copy() }
            notify(Change.TRANSFORM, Change.ANIMATION)
        }))
        notify(Change.TRANSFORM, Change.ANIMATION)
    }

    fun setTransform(o: SceneObject, t: Vec3? = null, r: Quat? = null, s: Vec3? = null, label: String = "Transform") {
        val before = beginTransform(o)
        locked { t?.let { o.position.set(it) }; r?.let { o.rotation.set(it) }; s?.let { o.scale.set(it) } }
        commitTransform(o, before, label)
    }

    fun resetTransform() {
        val o = scene.selected ?: return
        setTransform(o, Vec3(), Quat(), Vec3(1f, 1f, 1f), "Reset transform")
    }

    /** Bake the object's transform into its vertices. */
    fun applyTransform() {
        val o = scene.selected ?: return
        val beforeT = o.currentKeyframe()
        swapMesh("Apply transform", o, { m -> m.copy().also { it.applyTransform(o.localMatrix()) } }) {
            o.position.set(0f, 0f, 0f); o.rotation.identity(); o.scale.set(1f, 1f, 1f)
        }
        val after = o.currentKeyframe()
        // fold the transform reset into the same undo step
        val last = undoLast()
        if (last != null) undo.push(LambdaAction(last.label, { last.undo(); locked { o.applyKeyframe(beforeT) }; notify(Change.TRANSFORM) }, { last.redo(); locked { o.applyKeyframe(after) }; notify(Change.TRANSFORM) }, last.bytes))
    }

    private fun undoLast(): app.glbandme.core.sculpt.UndoAction? = undo.popLast()

    /** Move the pivot to the mesh's bounding-box center (or bottom) keeping the look. */
    fun originToGeometry(bottom: Boolean = false) {
        val o = scene.selected ?: return
        val before = o.currentKeyframe()
        var offset = FloatArray(3)
        swapMesh(if (bottom) "Origin to bottom" else "Origin to center", o, { m -> m.copy().also { offset = MeshOps.centerToOrigin(it, bottom) } }) {
            val world = Mat4.transformDir(o.localMatrix(), Vec3(offset[0], offset[1], offset[2]))
            o.position.addLocal(world)
        }
        val after = o.currentKeyframe()
        val last = undoLast()
        if (last != null) undo.push(LambdaAction(last.label, { last.undo(); locked { o.applyKeyframe(before) }; notify(Change.TRANSFORM) }, { last.redo(); locked { o.applyKeyframe(after) }; notify(Change.TRANSFORM) }, last.bytes))
    }

    fun dropToFloor() {
        val o = scene.selected ?: return
        val (mn, _) = o.worldBounds()
        setTransform(o, t = Vec3(o.position.x, o.position.y - mn.y, o.position.z), label = "Drop to floor")
    }

    // =========================================================================================
    // topology
    // =========================================================================================
    /**
     * Replace an object's mesh with [op] (run under lock) and record undo. [extra] runs under the
     * lock after the swap (e.g. transform fix-ups).
     */
    fun swapMesh(label: String, o: SceneObject, op: (Mesh) -> Mesh?, extra: (() -> Unit)? = null): Boolean {
        val old = o.mesh
        val oldPrim = o.primitive
        val newMesh = locked { op(old) } ?: return false
        locked {
            o.mesh = newMesh
            o.primitive = null
            extra?.invoke()
        }
        if (tool == Tool.SELECT) faces.bind(newMesh)
        undo.push(LambdaAction(label, {
            locked { o.mesh = old; o.primitive = oldPrim }
            if (tool == Tool.SELECT) faces.bind(old)
            notify(Change.TOPOLOGY, Change.EDIT_SELECTION)
        }, {
            locked { o.mesh = newMesh; o.primitive = null }
            if (tool == Tool.SELECT) faces.bind(newMesh)
            notify(Change.TOPOLOGY, Change.EDIT_SELECTION)
        }, (old.vertexCount + newMesh.vertexCount) * 48L + (old.indices.size + newMesh.indices.size) * 4L))
        notify(Change.TOPOLOGY, Change.EDIT_SELECTION)
        return true
    }

    fun subdivide(smooth: Boolean) = scene.selected?.let { o -> swapMesh(if (smooth) "Subdivide" else "Subdivide (simple)", o, { MeshOps.subdivide(it, smooth) }) }
    fun decimate(ratio: Float, progress: ((Float) -> Unit)? = null) = scene.selected?.let { o ->
        swapMesh("Decimate", o, { m -> Decimator.decimate(m, (m.triangleCount * ratio).toInt().coerceAtLeast(8), progress) })
    }
    fun smoothMesh(iter: Int) = scene.selected?.let { o -> swapMesh("Smooth mesh", o, { m -> m.copy().also { MeshOps.smoothInPlace(it, iter) } }) }
    fun symmetrize(axis: Int, posToNeg: Boolean) = scene.selected?.let { o -> swapMesh("Symmetrize", o, { m -> m.copy().also { MeshOps.symmetrizeInPlace(it, axis, posToNeg) } }) }
    fun weld() = scene.selected?.let { o -> swapMesh("Weld vertices", o, { m -> MeshOps.weld(m, m.averageEdgeLength() * 0.01f + 1e-6f) }) }
    fun shadeFlat() = scene.selected?.let { o -> swapMesh("Shade flat", o, { MeshOps.flatShaded(it) }) }
    fun shadeSmooth() = scene.selected?.let { o -> swapMesh("Shade smooth", o, { m -> MeshOps.smoothShaded(m).also { it.flatShading = false; it.computeNormals() } }) }
    fun flipNormals() = scene.selected?.let { o -> swapMesh("Flip normals", o, { m -> m.copy().also { it.flipWinding() } }) }
    fun recalcNormals() = scene.selected?.let { o -> swapMesh("Recalculate normals", o, { m -> m.copy().also { it.computeNormals() } }) }
    fun projectUvs(mode: MeshOps.UvProjection) = scene.selected?.let { o -> swapMesh("UV ${mode.label}", o, { MeshOps.projectUvs(it, mode) }) }
    fun bakePrimitive() {
        val o = scene.selected ?: return
        val spec = o.primitive ?: return
        locked { o.primitive = null }
        undo.push(LambdaAction("Convert to mesh", { locked { o.primitive = spec }; notify(Change.TOPOLOGY) }, { locked { o.primitive = null }; notify(Change.TOPOLOGY) }))
        notify(Change.TOPOLOGY)
    }

    /** Live primitive parameter edit (no undo per tick; caller commits). */
    fun updatePrimitive(o: SceneObject, spec: PrimitiveSpec) {
        val m = spec.build()
        locked { o.mesh = m; o.primitive = spec }
        notify(Change.TOPOLOGY)
    }

    fun commitPrimitive(o: SceneObject, beforeMesh: Mesh, beforeSpec: PrimitiveSpec) {
        val afterMesh = o.mesh; val afterSpec = o.primitive?.copy() ?: return
        undo.push(LambdaAction("Edit ${o.name}", { locked { o.mesh = beforeMesh; o.primitive = beforeSpec.copy() }; notify(Change.TOPOLOGY) },
            { locked { o.mesh = afterMesh; o.primitive = afterSpec.copy() }; notify(Change.TOPOLOGY) }))
    }

    // =========================================================================================
    // materials & paint
    // =========================================================================================
    fun materialChange(o: SceneObject, label: String, before: Material) {
        val after = o.material.copy()
        undo.push(LambdaAction(label, { locked { o.material.copyFrom(before) }; notify(Change.MATERIAL) }, { locked { o.material.copyFrom(after) }; notify(Change.MATERIAL) }))
        notify(Change.MATERIAL)
    }

    fun editMaterial(label: String, block: (Material) -> Unit) {
        val o = scene.selected ?: return
        val before = o.material.copy()
        locked { block(o.material) }
        materialChange(o, label, before)
    }

    private fun colorsAction(label: String, o: SceneObject, block: (Mesh) -> Unit) {
        val m = o.mesh
        val before = m.colors?.copyOf()
        locked { block(m) }
        val after = m.colors?.copyOf()
        undo.push(LambdaAction(label, { locked { m.colors = before?.copyOf(); m.markColorsDirty() }; notify(Change.MATERIAL) },
            { locked { m.colors = after?.copyOf(); m.markColorsDirty() }; notify(Change.MATERIAL) }, m.vertexCount * 32L))
        notify(Change.MATERIAL)
    }

    fun fillPaint() {
        val o = scene.selected ?: return
        val lin = app.glbandme.core.scene.Color.hexToLinear(paintColor)
        colorsAction("Fill color", o) { MeshOps.fillColor(it, lin[0], lin[1], lin[2]) }
    }

    fun clearPaint() {
        val o = scene.selected ?: return
        colorsAction("Clear paint", o) { it.colors = null; it.markColorsDirty() }
    }

    private fun maskAction(label: String, block: (Mesh) -> Unit) {
        val o = scene.selected ?: return
        val m = o.mesh
        val before = m.mask?.copyOf()
        locked { block(m) }
        val after = m.mask?.copyOf()
        undo.push(LambdaAction(label, { locked { m.mask = before?.copyOf(); m.markMaskDirty() }; notify(Change.MATERIAL) },
            { locked { m.mask = after?.copyOf(); m.markMaskDirty() }; notify(Change.MATERIAL) }, m.vertexCount * 8L))
        notify(Change.MATERIAL)
    }

    fun maskClear() = maskAction("Clear mask") { SculptEngine.maskClear(it) }
    fun maskInvert() = maskAction("Invert mask") { SculptEngine.maskInvert(it) }
    fun maskBlur() = maskAction("Blur mask") { SculptEngine.maskBlur(it) }
    fun maskSharpen() = maskAction("Sharpen mask") { SculptEngine.maskSharpen(it) }

    // =========================================================================================
    // edit mode (faces)
    // =========================================================================================
    fun editOp(label: String, op: (FaceSelection) -> Pair<Mesh, BooleanArray?>?) {
        val o = scene.selected ?: return
        faces.bind(o.mesh)
        val r = locked { op(faces) } ?: return
        val (newMesh, newSel) = r
        swapMesh(label, o, { newMesh })
        faces.rebind(newMesh, newSel ?: BooleanArray(newMesh.triangleCount))
        notify(Change.EDIT_SELECTION, Change.TOPOLOGY)
    }

    fun separateSelection(copyOnly: Boolean) {
        val o = scene.selected ?: return
        faces.bind(o.mesh)
        val part = faces.extract() ?: return
        val newObj = SceneObject(o.name + if (copyOnly) " part" else " separated", part, o.material.copy())
        newObj.position.set(o.position); newObj.rotation.set(o.rotation); newObj.scale.set(o.scale)
        if (!copyOnly) {
            val rest = faces.deleteFaces() ?: return
            swapMesh("Separate", o, { rest })
        }
        addObject(newObj, if (copyOnly) "Duplicate faces" else "Separate")
    }

    // =========================================================================================
    // animation
    // =========================================================================================
    fun setFrame(f: Float) {
        locked {
            scene.currentFrame = f.coerceIn(0f, scene.frameCount.toFloat())
            scene.evaluateAnimation()
        }
        notify(Change.FRAME)
    }

    fun keySelected() {
        val o = scene.selected ?: return
        val f = scene.currentFrame.toInt()
        val prev = o.keys[f]?.copy()
        val k = o.currentKeyframe()
        locked { o.keys[f] = k.copy() }
        undo.push(LambdaAction("Add keyframe", { locked { if (prev != null) o.keys[f] = prev else o.keys.remove(f) }; notify(Change.ANIMATION) },
            { locked { o.keys[f] = k.copy() }; notify(Change.ANIMATION) }))
        notify(Change.ANIMATION)
    }

    fun deleteKey() {
        val o = scene.selected ?: return
        val f = scene.currentFrame.toInt()
        val prev = o.keys[f]?.copy() ?: return
        locked { o.keys.remove(f) }
        undo.push(LambdaAction("Delete keyframe", { locked { o.keys[f] = prev }; notify(Change.ANIMATION) }, { locked { o.keys.remove(f) }; notify(Change.ANIMATION) }))
        notify(Change.ANIMATION)
    }

    fun clearAnimation(all: Boolean) {
        val targets = if (all) scene.objects.toList() else listOfNotNull(scene.selected)
        val saved = targets.associateWith { o -> o.keys.mapValues { it.value.copy() } }
        locked { for (o in targets) o.keys.clear() }
        undo.push(LambdaAction("Clear animation", {
            locked { for ((o, k) in saved) { o.keys.clear(); for ((f, kf) in k) o.keys[f] = kf.copy() } }; notify(Change.ANIMATION)
        }, { locked { for (o in targets) o.keys.clear() }; notify(Change.ANIMATION) }))
        notify(Change.ANIMATION)
    }

    /** Create a 360° turntable (Y spin) for the selected object over the scene length. */
    fun turntable() {
        val o = scene.selected ?: return
        val saved = o.keys.mapValues { it.value.copy() }
        val base = o.currentKeyframe()
        val n = scene.frameCount
        locked {
            o.keys.clear()
            for (i in 0..4) {
                val q = (Quat.axisAngle(Vec3(0f, 1f, 0f), i * Math.PI.toFloat() / 2f) * base.rotation).normalize()
                o.keys[n * i / 4] = Keyframe(base.position.copy(), q, base.scale.copy())
            }
        }
        val after = o.keys.mapValues { it.value.copy() }
        undo.push(LambdaAction("Turntable", { locked { o.keys.clear(); for ((f, k) in saved) o.keys[f] = k.copy(); o.applyKeyframe(base) }; notify(Change.ANIMATION) },
            { locked { o.keys.clear(); for ((f, k) in after) o.keys[f] = k.copy() }; notify(Change.ANIMATION) }))
        notify(Change.ANIMATION)
    }

    fun keyFrames(o: SceneObject?): List<Int> = o?.keys?.keys?.toList() ?: emptyList()
}
