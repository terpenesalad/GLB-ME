package app.glbandme.core.scene

import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.PrimitiveSpec
import app.glbandme.math.Mat4
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import java.util.TreeMap
import kotlin.math.floor

/** Transform keyframe. */
class Keyframe(val position: Vec3, val rotation: Quat, val scale: Vec3) {
    fun copy() = Keyframe(position.copy(), rotation.copy(), scale.copy())
}

class SceneObject(
    var name: String,
    var mesh: Mesh,
    var material: Material = Material()
) {
    val uid: Long = nextUid++
    val position = Vec3()
    val rotation = Quat()
    val scale = Vec3(1f, 1f, 1f)
    var visible = true
    var locked = false
    /** Still procedural (editable parameters) until baked by sculpting/topology edits. */
    var primitive: PrimitiveSpec? = null
    /** 3D text parameters (editable until the mesh is sculpted / edited). */
    var text: TextSpec? = null
    /** When set this object is a light; its mesh is only an on-screen stand-in. */
    var light: LightSpec? = null
    /** frame -> transform */
    val keys = TreeMap<Int, Keyframe>()

    fun localMatrix(out: FloatArray = FloatArray(16)): FloatArray = Mat4.fromTRS(position, rotation, scale, out)

    fun currentKeyframe() = Keyframe(position.copy(), rotation.copy(), scale.copy())

    fun applyKeyframe(k: Keyframe) {
        position.set(k.position); rotation.set(k.rotation); scale.set(k.scale)
    }

    fun setTransform(m: FloatArray) = Mat4.decompose(m, position, rotation, scale)

    /** Evaluate the animation at fractional frame f (no-op without keys). */
    fun evaluate(f: Float) {
        if (keys.isEmpty()) return
        val lo = keys.floorEntry(floor(f).toInt()) ?: keys.firstEntry()
        val hi = keys.ceilingEntry(floor(f).toInt() + 1) ?: keys.lastEntry()
        if (lo == null || hi == null) return
        if (lo.key >= hi.key || f <= lo.key) { applyKeyframe(lo.value); return }
        if (f >= hi.key) { applyKeyframe(hi.value); return }
        val t = (f - lo.key) / (hi.key - lo.key)
        val a = lo.value; val b = hi.value
        position.set(a.position.lerp(b.position, t))
        scale.set(a.scale.lerp(b.scale, t))
        rotation.set(Quat.slerp(a.rotation, b.rotation, t))
    }

    fun duplicate(copyMesh: Boolean = true): SceneObject {
        val o = SceneObject("$name copy", if (copyMesh) mesh.copy() else mesh, material.copy())
        o.position.set(position); o.rotation.set(rotation); o.scale.set(scale)
        o.visible = visible
        o.primitive = primitive?.copy()
        o.text = text?.copy()
        o.light = light?.copy()
        o.locked = locked
        for ((f, k) in keys) o.keys[f] = k.copy()
        return o
    }

    /** World-space bounds of the transformed mesh corners. */
    fun worldBounds(): Pair<Vec3, Vec3> {
        val (mn, mx) = mesh.bounds()
        val m = localMatrix()
        val lo = Vec3(Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE)
        val hi = Vec3(-Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE)
        val tmp = FloatArray(3)
        for (i in 0 until 8) {
            val x = if (i and 1 == 0) mn.x else mx.x
            val y = if (i and 2 == 0) mn.y else mx.y
            val z = if (i and 4 == 0) mn.z else mx.z
            Mat4.transformPoint(m, x, y, z, tmp)
            lo.minLocal(Vec3(tmp[0], tmp[1], tmp[2])); hi.maxLocal(Vec3(tmp[0], tmp[1], tmp[2]))
        }
        return lo to hi
    }

    companion object { private var nextUid = 1L }
}

enum class ShadingMode(val label: String) { PBR("PBR"), MATCAP("Matcap"), FLAT_CLAY("Clay"), NORMALS("Normals"), UNLIT("Unlit") }

enum class EnvPreset(val label: String) { STUDIO("Studio"), SUNSET("Sunset"), NIGHT("Night"), OVERCAST("Overcast"), NEON("Neon"), DARK("Lights only") }

/** Viewport/render settings saved with the project. */
class RenderSettings {
    var shading = ShadingMode.PBR
    var matcap = 0
    var env = EnvPreset.STUDIO
    var exposure = 1f
    var lightAngle = -40f
    var lightHeight = 45f
    var shadows = true
    var showGrid = true
    var wireframe = false
    var bgTop = 0x2B2E3A
    var bgBottom = 0x101116
    var orthographic = false
    var fov = 45f
    var showAxes = true

    fun copyFrom(o: RenderSettings) {
        shading = o.shading; matcap = o.matcap; env = o.env; exposure = o.exposure; lightAngle = o.lightAngle
        lightHeight = o.lightHeight; shadows = o.shadows; showGrid = o.showGrid; wireframe = o.wireframe
        bgTop = o.bgTop; bgBottom = o.bgBottom; orthographic = o.orthographic; fov = o.fov; showAxes = o.showAxes
    }
}

/** Saved orbit camera. */
class CameraState(
    var yaw: Float = 35f, var pitch: Float = 20f, var distance: Float = 3.2f,
    val target: Vec3 = Vec3(0f, 0f, 0f)
) {
    fun copyFrom(o: CameraState) { yaw = o.yaw; pitch = o.pitch; distance = o.distance; target.set(o.target) }
}

class Scene {
    val objects = ArrayList<SceneObject>()
    var selected: SceneObject? = null
    val render = RenderSettings()
    val camera = CameraState()
    var fps = 30
    var frameCount = 90
    var currentFrame = 0f

    fun add(o: SceneObject, select: Boolean = true): SceneObject {
        objects.add(o)
        if (select) selected = o
        return o
    }

    fun remove(o: SceneObject) {
        objects.remove(o)
        if (selected === o) selected = objects.lastOrNull()
    }

    fun uniqueName(base: String): String {
        val names = objects.map { it.name }.toHashSet()
        if (base !in names) return base
        var i = 2
        while ("$base.$i" in names) i++
        return "$base.$i"
    }

    fun hasAnimation() = objects.any { it.keys.isNotEmpty() }

    fun evaluateAnimation(frame: Float = currentFrame) {
        for (o in objects) o.evaluate(frame)
    }

    fun totalTriangles() = objects.sumOf { if (it.light != null) 0 else it.mesh.triangleCount }
    fun totalVertices() = objects.sumOf { it.mesh.vertexCount }

    fun bounds(onlyVisible: Boolean = true): Pair<Vec3, Vec3>? {
        var lo: Vec3? = null; var hi: Vec3? = null
        for (o in objects) {
            if (onlyVisible && !o.visible) continue
            if (o.mesh.vertexCount == 0) continue
            val (a, b) = o.worldBounds()
            lo = lo?.minLocal(a) ?: a.copy()
            hi = hi?.maxLocal(b) ?: b.copy()
        }
        return if (lo != null && hi != null) lo to hi else null
    }

    fun textures(): List<Texture> = objects.flatMap { it.material.textures() }.distinctBy { it.uid }
}
