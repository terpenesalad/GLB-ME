package app.glbandme.editor

import app.glbandme.core.scene.Keyframe
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.sculpt.LambdaAction
import app.glbandme.math.Mat4
import app.glbandme.math.MathUtil
import app.glbandme.math.Quat
import app.glbandme.math.Vec3
import app.glbandme.render.OrbitCamera
import app.glbandme.ui.Theme
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Screen-space transform gizmo for objects (Transform tool) and face selections (Select tool).
 * Geometry is computed on demand from the camera so drawing and hit-testing always agree.
 */
class Gizmo(private val ed: Editor, private val cam: OrbitCamera) {
    companion object {
        const val NONE = -1; const val X = 0; const val Y = 1; const val Z = 2; const val CENTER = 3; const val VIEW = 4
    }

    var active = NONE; private set
    var hover = NONE

    private val lengthPx get() = Theme.dp(92f)

    /** Set while the interface is hidden for clean viewing. */
    var suppressed = false

    fun visible(): Boolean {
        if (suppressed) return false
        val o = ed.scene.selected ?: return false
        if (!o.visible) return false
        return when (ed.tool) {
            Tool.TRANSFORM -> true
            Tool.SELECT -> !ed.faces.isEmpty()
            else -> false
        }
    }

    private val editMode get() = ed.tool == Tool.SELECT

    /** World-space gizmo origin. */
    fun center(): Vec3? {
        val o = ed.scene.selected ?: return null
        return if (editMode) ed.faces.centroid()?.let { Mat4.transformPoint(o.localMatrix(), it) } else o.position.copy()
    }

    /** Unit axes the handles operate along. */
    fun axes(): Array<Vec3> {
        val o = ed.scene.selected
        val world = arrayOf(Vec3(1f, 0f, 0f), Vec3(0f, 1f, 0f), Vec3(0f, 0f, 1f))
        if (o == null || ed.gizmoMode != GizmoMode.SCALE || editMode) return world
        return arrayOf(o.rotation.rotate(world[0]), o.rotation.rotate(world[1]), o.rotation.rotate(world[2]))
    }

    /** Screen-space geometry: origin + axis endpoints (x,y pairs). */
    class Geo(val cx: Float, val cy: Float, val ends: FloatArray, val worldLen: Float, val facing: FloatArray)

    fun geometry(): Geo? {
        val c = center() ?: return null
        cam.update()
        val sc = cam.project(c)
        if (sc[2] < 0f) return null
        val wl = lengthPx * cam.worldPerPixel(c)
        val ax = axes()
        val ends = FloatArray(6)
        val facing = FloatArray(3)
        val fwd = cam.forward()
        for (i in 0 until 3) {
            val e = cam.project(c + ax[i] * wl)
            ends[i * 2] = e[0]; ends[i * 2 + 1] = e[1]
            facing[i] = ax[i].dot(fwd)
        }
        return Geo(sc[0], sc[1], ends, wl, facing)
    }

    private fun distToSeg(px: Float, py: Float, ax: Float, ay: Float, bx: Float, by: Float): Float {
        val dx = bx - ax; val dy = by - ay
        val l2 = dx * dx + dy * dy
        val t = if (l2 < 1e-6f) 0f else (((px - ax) * dx + (py - ay) * dy) / l2).coerceIn(0f, 1f)
        return hypot(px - (ax + dx * t), py - (ay + dy * t))
    }

    /** Ring for axis i as a screen polyline. */
    fun ring(i: Int, g: Geo, samples: Int = 48): FloatArray {
        val c = center() ?: return FloatArray(0)
        val ax = axes()
        val u = ax[(i + 1) % 3]; val v = ax[(i + 2) % 3]
        val r = g.worldLen * 0.85f
        val out = FloatArray(samples * 2)
        for (k in 0 until samples) {
            val a = k.toFloat() / samples * 2f * MathUtil.PI
            val p = c + u * (cos(a) * r) + v * (sin(a) * r)
            val s = cam.project(p)
            out[k * 2] = s[0]; out[k * 2 + 1] = s[1]
        }
        return out
    }

    fun hit(x: Float, y: Float): Int {
        if (!visible()) return NONE
        val g = geometry() ?: return NONE
        val tol = Theme.dp(22f)
        when (ed.gizmoMode) {
            GizmoMode.MOVE, GizmoMode.SCALE -> {
                if (hypot(x - g.cx, y - g.cy) < Theme.dp(20f)) return CENTER
                var best = NONE; var bestD = tol
                for (i in 0 until 3) {
                    val d = distToSeg(x, y, g.cx, g.cy, g.ends[i * 2], g.ends[i * 2 + 1])
                    if (d < bestD && hypot(x - g.cx, y - g.cy) > Theme.dp(14f)) { bestD = d; best = i }
                }
                return best
            }
            GizmoMode.ROTATE -> {
                var best = NONE; var bestD = tol
                for (i in 0 until 3) {
                    val r = ring(i, g)
                    val n = r.size / 2
                    for (k in 0 until n) {
                        val j = (k + 1) % n
                        val d = distToSeg(x, y, r[k * 2], r[k * 2 + 1], r[j * 2], r[j * 2 + 1])
                        if (d < bestD) { bestD = d; best = i }
                    }
                }
                if (best != NONE) return best
                val rv = lengthPx * 1.12f
                if (abs(hypot(x - g.cx, y - g.cy) - rv) < tol) return VIEW
                return NONE
            }
        }
    }

    // ------------------------------------------------------------------------------------------
    // dragging
    // ------------------------------------------------------------------------------------------
    private var x0 = 0f; private var y0 = 0f
    private var startGeo: Geo? = null
    private var startCenter = Vec3()
    private var startKey: Keyframe? = null
    private var obj: SceneObject? = null
    // edit mode
    private var verts = IntArray(0)
    private var orig = FloatArray(0)
    private var localCenter = Vec3()
    private var inv = FloatArray(16)
    var feedback: String? = null; private set

    fun begin(handle: Int, x: Float, y: Float) {
        val o = ed.scene.selected ?: return
        active = handle
        x0 = x; y0 = y
        obj = o
        startGeo = geometry()
        startCenter = center() ?: Vec3()
        if (editMode) {
            verts = ed.faces.selectedVertices()
            val p = o.mesh.positions
            orig = FloatArray(verts.size * 3)
            for (i in verts.indices) System.arraycopy(p, verts[i] * 3, orig, i * 3, 3)
            localCenter = ed.faces.centroid() ?: Vec3()
            Mat4.invert(o.localMatrix(), inv)
        } else startKey = ed.beginTransform(o)
    }

    private fun snapTo(v: Float, step: Float) = if (ed.snap) (v / step).roundToInt() * step else v

    fun drag(x: Float, y: Float) {
        val o = obj ?: return
        val g = startGeo ?: return
        val ax = axes()
        val dx = x - x0; val dy = y - y0
        ed.locked {
            when (ed.gizmoMode) {
                GizmoMode.MOVE -> {
                    val delta: Vec3 = if (active == CENTER) {
                        val wpp = cam.worldPerPixel(startCenter)
                        cam.right() * (dx * wpp) + cam.up() * (-dy * wpp)
                    } else {
                        val sx = g.ends[active * 2] - g.cx; val sy = g.ends[active * 2 + 1] - g.cy
                        val l2 = sx * sx + sy * sy
                        if (l2 < 4f) return@locked
                        val t = snapTo((dx * sx + dy * sy) / l2 * g.worldLen, 0.1f)
                        ax[active] * t
                    }
                    feedback = String.format("Δ %.3f  %.3f  %.3f", delta.x, delta.y, delta.z)
                    if (editMode) moveVerts(o) { _, p -> p.addLocal(Mat4.transformDir(inv, delta)) }
                    else { val k = startKey!!; o.position.set(k.position + delta) }
                }
                GizmoMode.ROTATE -> {
                    val a0 = atan2(y0 - g.cy, x0 - g.cx); val a1 = atan2(y - g.cy, x - g.cx)
                    var ang = a1 - a0
                    val axis = if (active == VIEW) cam.forward() * -1f else ax[active]
                    val facing = axis.dot(cam.forward())
                    if (facing < 0f) ang = -ang
                    var deg = ang / MathUtil.DEG
                    while (deg > 180f) deg -= 360f
                    while (deg < -180f) deg += 360f
                    deg = snapTo(deg, 15f)
                    feedback = String.format("%.1f°", deg)
                    val q = Quat.axisAngle(axis, deg * MathUtil.DEG)
                    if (editMode) {
                        val la = Mat4.transformDir(inv, axis).normalize()
                        val lq = Quat.axisAngle(la, deg * MathUtil.DEG)
                        moveVerts(o) { _, p -> val d = p - localCenter; p.set(localCenter + lq.rotate(d)) }
                    } else { val k = startKey!!; o.rotation.set((q * k.rotation).normalize()) }
                }
                GizmoMode.SCALE -> {
                    val f: Float = if (active == CENTER) {
                        max(0.01f, 1f + (dx - dy) / Theme.dp(160f))
                    } else {
                        val sx = g.ends[active * 2] - g.cx; val sy = g.ends[active * 2 + 1] - g.cy
                        val l2 = sx * sx + sy * sy
                        if (l2 < 4f) return@locked
                        max(0.01f, 1f + (dx * sx + dy * sy) / l2)
                    }
                    val fs = snapTo(f, 0.1f).coerceAtLeast(0.01f)
                    feedback = String.format("× %.2f", fs)
                    if (editMode) {
                        val la = if (active == CENTER) null else Mat4.transformDir(inv, ax[active]).normalize()
                        moveVerts(o) { _, p ->
                            val d = p - localCenter
                            if (la == null) p.set(localCenter + d * fs)
                            else p.set(localCenter + d + la * (d.dot(la) * (fs - 1f)))
                        }
                    } else {
                        val k = startKey!!
                        if (active == CENTER) o.scale.set(k.scale * fs)
                        else { o.scale.set(k.scale); o.scale[active] = k.scale[active] * fs }
                    }
                }
            }
        }
        ed.notify(Change.TRANSFORM)
    }

    private inline fun moveVerts(o: SceneObject, f: (Int, Vec3) -> Unit) {
        val m = o.mesh
        val p = m.positions
        val tmp = Vec3()
        for (i in verts.indices) {
            tmp.set(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2])
            f(i, tmp)
            val v = verts[i]
            p[v * 3] = tmp.x; p[v * 3 + 1] = tmp.y; p[v * 3 + 2] = tmp.z
        }
        if (verts.isNotEmpty()) {
            m.updateNormals(verts, verts.size, IntArray(m.vertexCount), 1)
        }
    }

    fun end() {
        val o = obj
        if (o != null && active != NONE) {
            if (editMode) {
                val m = o.mesh
                val before = orig.copyOf()
                val idx = verts.copyOf()
                val after = FloatArray(idx.size * 3)
                for (i in idx.indices) System.arraycopy(m.positions, idx[i] * 3, after, i * 3, 3)
                fun apply(src: FloatArray) {
                    ed.locked {
                        for (i in idx.indices) System.arraycopy(src, i * 3, m.positions, idx[i] * 3, 3)
                        m.updateNormals(idx, idx.size, IntArray(m.vertexCount), 1)
                    }
                    ed.notify(Change.TOPOLOGY)
                }
                ed.undo.push(LambdaAction("${ed.gizmoMode.label} faces", { apply(before) }, { apply(after) }, idx.size * 28L))
                ed.locked { o.primitive = null; o.text = null }
                ed.notify(Change.TOPOLOGY)
            } else startKey?.let { ed.commitTransform(o, it, ed.gizmoMode.label) }
        }
        active = NONE
        obj = null
        feedback = null
    }

    fun cancel() {
        val o = obj
        if (o != null && active != NONE) {
            ed.locked {
                if (editMode) {
                    for (i in verts.indices) System.arraycopy(orig, i * 3, o.mesh.positions, verts[i] * 3, 3)
                    o.mesh.updateNormals(verts, verts.size, IntArray(o.mesh.vertexCount), 1)
                } else startKey?.let { o.applyKeyframe(it) }
            }
        }
        active = NONE; obj = null; feedback = null
        ed.notify(Change.TRANSFORM)
    }

    @Suppress("unused")
    private fun len(x: Float, y: Float) = sqrt(x * x + y * y)
}
