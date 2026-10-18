package app.glbandme.render

import app.glbandme.core.scene.CameraState
import app.glbandme.math.Mat4
import app.glbandme.math.MathUtil
import app.glbandme.math.Vec3
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin
import kotlin.math.tan

/** Turntable orbit camera (yaw/pitch around a target), Nomad-style. */
class OrbitCamera(val state: CameraState) {
    var width = 1; private set
    var height = 1; private set
    var fovDeg = 45f
    var ortho = false
    /** Vertical lens shift in NDC (+ moves the image up), used to keep the model visible above sheets. */
    var shiftY = 0f
    var shiftX = 0f
    val view = FloatArray(16)
    val proj = FloatArray(16)
    val viewProj = FloatArray(16)
    val invViewProj = FloatArray(16)
    val eye = Vec3()
    var near = 0.01f; private set
    var far = 100f; private set

    fun setViewport(w: Int, h: Int) { width = max(1, w); height = max(1, h) }

    fun update() {
        val yaw = state.yaw * MathUtil.DEG
        val pitch = state.pitch * MathUtil.DEG
        val d = state.distance
        eye.set(
            state.target.x + sin(yaw) * cos(pitch) * d,
            state.target.y + sin(pitch) * d,
            state.target.z + cos(yaw) * cos(pitch) * d
        )
        val up = if (cos(pitch) >= 0) Vec3(0f, 1f, 0f) else Vec3(0f, -1f, 0f)
        Mat4.lookAt(eye, state.target, up, view)
        near = max(d * 0.005f, 1e-4f)
        far = d * 60f + 50f
        val aspect = width.toFloat() / height
        if (ortho) {
            val hh = d * tan(fovDeg * MathUtil.DEG / 2f)
            Mat4.ortho(-hh * aspect, hh * aspect, -hh, hh, -far, far, proj)
        } else Mat4.perspective(fovDeg * MathUtil.DEG, aspect, near, far, proj)
        if (shiftY != 0f) { if (ortho) proj[13] += shiftY else proj[9] -= shiftY }
        if (shiftX != 0f) { if (ortho) proj[12] += shiftX else proj[8] -= shiftX }
        Mat4.mul(proj, view, viewProj)
        Mat4.invert(viewProj, invViewProj)
    }

    /** World ray through screen pixel. Returns origin & normalized direction. */
    fun ray(sx: Float, sy: Float): Pair<Vec3, Vec3> {
        update()
        val nx = sx / width * 2f - 1f
        val ny = 1f - sy / height * 2f
        val a = FloatArray(3); val b = FloatArray(3)
        Mat4.transformPoint(invViewProj, nx, ny, -1f, a)
        Mat4.transformPoint(invViewProj, nx, ny, 1f, b)
        val o = Vec3(a[0], a[1], a[2])
        val dir = Vec3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize()
        return o to dir
    }

    /** Screen position of a world point; z < 0 or > 1 means off-screen/behind. */
    fun project(p: Vec3, out: FloatArray = FloatArray(3)): FloatArray {
        val w = Mat4.project(viewProj, p.x, p.y, p.z, out)
        out[0] = (out[0] * 0.5f + 0.5f) * width
        out[1] = (1f - (out[1] * 0.5f + 0.5f)) * height
        if (w <= 0f) out[2] = -1f
        return out
    }

    /** World units per screen pixel at the given world point. */
    fun worldPerPixel(at: Vec3): Float {
        if (ortho) return 2f * state.distance * tan(fovDeg * MathUtil.DEG / 2f) / height
        val forward = (state.target - eye).normalize()
        val depth = max((at - eye).dot(forward), near)
        return 2f * depth * tan(fovDeg * MathUtil.DEG / 2f) / height
    }

    fun right(): Vec3 = Vec3(view[0], view[4], view[8])
    fun up(): Vec3 = Vec3(view[1], view[5], view[9])
    fun forward(): Vec3 = Vec3(-view[2], -view[6], -view[10])

    fun orbit(dxPx: Float, dyPx: Float, sensitivity: Float = 0.35f) {
        state.yaw = (state.yaw - dxPx * sensitivity) % 360f
        state.pitch = (state.pitch + dyPx * sensitivity).coerceIn(-89.5f, 89.5f)
    }

    fun pan(dxPx: Float, dyPx: Float) {
        update()
        val wpp = worldPerPixel(state.target)
        val r = right(); val u = up()
        state.target.addScaled(r, -dxPx * wpp)
        state.target.addScaled(u, dyPx * wpp)
    }

    fun zoom(factor: Float) {
        state.distance = (state.distance / factor).coerceIn(0.01f, 5000f)
    }

    /** Dolly toward a point while zooming (zoom to cursor). */
    fun zoomAt(factor: Float, focus: Vec3?) {
        val before = state.distance
        zoom(factor)
        if (focus != null) {
            val k = 1f - state.distance / before
            state.target.addScaled(focus - state.target, k * 0.6f)
        }
    }

    fun frame(min: Vec3, max: Vec3, keepAngles: Boolean = true) {
        val c = (min + max) * 0.5f
        val r = max((max - min).length() * 0.5f, 0.05f)
        state.target.set(c)
        state.distance = r / sin(fovDeg * MathUtil.DEG / 2f) * 1.08f
        if (!keepAngles) { state.yaw = 35f; state.pitch = 20f }
    }

    enum class View(val label: String, val yaw: Float, val pitch: Float) {
        FRONT("Front", 0f, 0f), BACK("Back", 180f, 0f), RIGHT("Right", 90f, 0f), LEFT("Left", -90f, 0f),
        TOP("Top", 0f, 89.5f), BOTTOM("Bottom", 0f, -89.5f)
    }

    fun snap(v: View) { state.yaw = v.yaw; state.pitch = v.pitch }
}
