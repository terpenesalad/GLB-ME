package app.glbandme.editor

import android.annotation.SuppressLint
import android.content.Context
import android.opengl.GLSurfaceView
import android.os.SystemClock
import android.view.MotionEvent
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.sculpt.BrushType
import app.glbandme.core.sculpt.Picking
import app.glbandme.math.Mat4
import app.glbandme.math.Vec3
import app.glbandme.render.OrbitCamera
import app.glbandme.render.RenderOptions
import app.glbandme.render.SceneRenderer
import app.glbandme.ui.Prefs
import app.glbandme.ui.Theme
import javax.microedition.khronos.egl.EGL10
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.egl.EGLDisplay
import javax.microedition.khronos.opengles.GL10
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.sqrt

/**
 * The 3D viewport: GL rendering plus all touch interaction (navigation, sculpt strokes,
 * selection, gizmo dragging, multi-finger undo/redo taps).
 */
@SuppressLint("ViewConstructor")
class Viewport(ctx: Context, val ed: Editor, msaa: Boolean) : GLSurfaceView(ctx) {
    val renderer = SceneRenderer()
    /** Camera used by the UI thread (overlay, picking). The GL thread has its own instance. */
    val uiCam = OrbitCamera(ed.scene.camera)
    private val glCam = OrbitCamera(ed.scene.camera)
    val gizmo = Gizmo(ed, uiCam)
    var overlay: Overlay? = null
    var onStatus: ((String?) -> Unit)? = null
    var fps = 0f; private set
    private var frameTimes = LongArray(30)
    private var frameIdx = 0
    @Volatile var pendingCapture: ((android.graphics.Bitmap) -> Unit)? = null
    @Volatile var captureSize = 0
    @Volatile var captureTransparent = false
    private val prefs = Prefs.of(ctx)

    init {
        setEGLContextClientVersion(3)
        setEGLConfigChooser(ConfigChooser(msaa))
        preserveEGLContextOnPause = true
        setRenderer(object : Renderer {
            override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
                renderer.contextLost()
                renderer.init()
            }

            override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
                glCam.setViewport(width, height)
            }

            override fun onDrawFrame(gl: GL10?) {
                val opt = RenderOptions().apply {
                    accent = Theme.accentRgb()
                    showMask = ed.showMask
                    outlineSelected = (ed.tool == Tool.TRANSFORM || ed.tool == Tool.SELECT) && !gizmo.suppressed
                    if (ed.tool == Tool.SELECT) {
                        editWire = true
                        if (ed.faces.mesh === ed.scene.selected?.mesh) editSelection = ed.faces.version to ed.faces.list()
                    }
                }
                synchronized(ed.scene) {
                    renderer.render(ed.scene, glCam, width, height, opt)
                    val cap = pendingCapture
                    if (cap != null) {
                        pendingCapture = null
                        val s = if (captureSize > 0) captureSize else max(width, height)
                        val w: Int; val h: Int
                        if (captureSize > 0) { w = s; h = s } else { w = width; h = height }
                        val camCopy = OrbitCamera(ed.scene.camera)
                        val bmp = renderer.renderToBitmap(ed.scene, camCopy, w, h, RenderOptions().apply {
                            transparentBackground = captureTransparent; outlineSelected = false; showMask = false
                        })
                        post { cap(bmp) }
                    }
                }
                val now = SystemClock.elapsedRealtimeNanos()
                frameTimes[frameIdx % frameTimes.size] = now
                frameIdx++
                if (frameIdx > frameTimes.size) {
                    val oldest = frameTimes[frameIdx % frameTimes.size]
                    fps = (frameTimes.size - 1) * 1e9f / (now - oldest).coerceAtLeast(1)
                }
            }
        })
        renderMode = RENDERMODE_WHEN_DIRTY
        ed.requestRender = { requestRender(); overlay?.postInvalidateOnAnimation() }
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        uiCam.setViewport(w, h)
    }

    /** Request a screenshot of the current view (or square [size]). */
    fun capture(size: Int, transparent: Boolean, cb: (android.graphics.Bitmap) -> Unit) {
        captureSize = size; captureTransparent = transparent
        pendingCapture = cb
        requestRender()
    }

    // =========================================================================================
    // touch
    // =========================================================================================
    private enum class Mode { NONE, ORBIT, NAV, STROKE, GIZMO, NAVIGATOR }
    private var mode = Mode.NONE
    private var downTime = 0L
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastY = 0f
    private var maxPointers = 0
    private var moved = false
    private var lastSpan = 0f
    private var lastCx = 0f
    private var lastCy = 0f
    private var lastTapTime = 0L
    private var lastTapX = 0f
    private var lastTapY = 0f
    private val stroke = Stroke()

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        val ov = overlay
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downTime = e.eventTime; downX = e.x; downY = e.y; lastX = e.x; lastY = e.y
                maxPointers = 1; moved = false
                synchronized(ed.scene) { uiCam.fovDeg = ed.scene.render.fov; uiCam.ortho = ed.scene.render.orthographic; uiCam.update() }
                mode = Mode.ORBIT
                if (ov != null && ov.navigatorHit(e.x, e.y) != null) { mode = Mode.NAVIGATOR; return true }
                val isStylus = e.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS
                val handle = synchronized(ed.scene) { gizmo.hit(e.x, e.y) }
                if (handle != Gizmo.NONE) {
                    synchronized(ed.scene) { gizmo.begin(handle, e.x, e.y) }
                    mode = Mode.GIZMO
                    ov?.invalidate()
                    return true
                }
                val canStroke = (ed.tool.isBrush || ed.tool == Tool.SELECT) && (!prefs.stylusOnly || isStylus)
                if (canStroke && stroke.begin(e.x, e.y, pressure(e, 0))) {
                    mode = Mode.STROKE
                    ov?.brush(e.x, e.y, stroke.radiusPx, true)
                }
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                maxPointers = max(maxPointers, e.pointerCount)
                when (mode) {
                    Mode.STROKE -> { if (SystemClock.uptimeMillis() - downTime < 220 || !stroke.hasEffect()) stroke.cancel() else stroke.end(); ov?.brush(0f, 0f, 0f, false) }
                    Mode.GIZMO -> synchronized(ed.scene) { gizmo.cancel() }
                    else -> {}
                }
                mode = Mode.NAV
                lastSpan = span(e); lastCx = cx(e); lastCy = cy(e)
            }
            MotionEvent.ACTION_MOVE -> {
                if (hypot(e.x - downX, e.y - downY) > Theme.dp(8f)) moved = true
                when (mode) {
                    Mode.ORBIT -> {
                        if (moved) {
                            val k = prefs.orbitSpeed * 0.35f * 1080f / max(width, height).coerceAtLeast(1)
                            val dy = (e.y - lastY) * (if (prefs.invertOrbit) -1f else 1f)
                            synchronized(ed.scene) { uiCam.orbit(e.x - lastX, dy, k) }
                            ed.requestRender()
                        }
                    }
                    Mode.NAV -> if (e.pointerCount >= 2) {
                        val s = span(e); val x = cx(e); val y = cy(e)
                        synchronized(ed.scene) {
                            if (lastSpan > 10f && s > 10f) uiCam.zoom(s / lastSpan)
                            uiCam.pan(x - lastCx, y - lastCy)
                        }
                        lastSpan = s; lastCx = x; lastCy = y
                        if (hypot(x - downX, y - downY) > Theme.dp(10f)) moved = true
                        ed.requestRender()
                    }
                    Mode.STROKE -> {
                        for (h in 0 until e.historySize) stroke.move(e.getHistoricalX(0, h), e.getHistoricalY(0, h), e.getHistoricalPressure(0, h).let { if (isStylus(e)) it else 1f })
                        stroke.move(e.x, e.y, pressure(e, 0))
                        ov?.brush(e.x, e.y, stroke.radiusPx, true)
                    }
                    Mode.GIZMO -> {
                        synchronized(ed.scene) { uiCam.update() }
                        gizmo.drag(e.x, e.y)
                        onStatus?.invoke(gizmo.feedback)
                    }
                    else -> {}
                }
                lastX = e.x; lastY = e.y
            }
            MotionEvent.ACTION_POINTER_UP -> {
                if (mode == Mode.NAV && e.pointerCount - 1 < 2) {
                    // stay in NAV until all fingers are up (prevents orbit jumps)
                }
                if (e.pointerCount > 2) { lastSpan = span(e, e.actionIndex); lastCx = cx(e, e.actionIndex); lastCy = cy(e, e.actionIndex) }
            }
            MotionEvent.ACTION_UP -> {
                val quick = e.eventTime - downTime < 300 && !moved
                when (mode) {
                    Mode.STROKE -> { stroke.end(); ov?.brush(0f, 0f, 0f, false) }
                    Mode.GIZMO -> { gizmo.end(); onStatus?.invoke(null) }
                    Mode.NAVIGATOR -> { ov?.navigatorHit(e.x, e.y)?.let { v -> synchronized(ed.scene) { uiCam.snap(v) }; ed.requestRender() } }
                    Mode.NAV -> if (quick && prefs.tapUndo) {
                        if (maxPointers == 2) ed.undo.undo()?.let { onStatus?.invoke("Undo $it"); postDelayed({ onStatus?.invoke(null) }, 900) }
                        else if (maxPointers >= 3) ed.undo.redo()?.let { onStatus?.invoke("Redo $it"); postDelayed({ onStatus?.invoke(null) }, 900) }
                    }
                    Mode.ORBIT -> if (quick) singleTap(e.x, e.y)
                    else -> {}
                }
                if (mode == Mode.STROKE && quick && ed.tool == Tool.SELECT) { /* tap already painted */ }
                mode = Mode.NONE
                ov?.invalidate()
            }
            MotionEvent.ACTION_CANCEL -> {
                when (mode) {
                    Mode.STROKE -> { stroke.end(); ov?.brush(0f, 0f, 0f, false) }
                    Mode.GIZMO -> gizmo.cancel()
                    else -> {}
                }
                mode = Mode.NONE
            }
        }
        return true
    }

    private fun isStylus(e: MotionEvent) = e.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS
    private fun pressure(e: MotionEvent, i: Int) = if (e.getToolType(i) == MotionEvent.TOOL_TYPE_STYLUS && prefs.stylusPressure) e.getPressure(i) else 1f

    private fun span(e: MotionEvent, skip: Int = -1): Float {
        var sx = 0f; var sy = 0f; var n = 0
        for (i in 0 until e.pointerCount) if (i != skip) { sx += e.getX(i); sy += e.getY(i); n++ }
        if (n == 0) return 0f
        sx /= n; sy /= n
        var d = 0f
        for (i in 0 until e.pointerCount) if (i != skip) d += hypot(e.getX(i) - sx, e.getY(i) - sy)
        return d / n
    }
    private fun cx(e: MotionEvent, skip: Int = -1): Float { var s = 0f; var n = 0; for (i in 0 until e.pointerCount) if (i != skip) { s += e.getX(i); n++ }; return if (n > 0) s / n else 0f }
    private fun cy(e: MotionEvent, skip: Int = -1): Float { var s = 0f; var n = 0; for (i in 0 until e.pointerCount) if (i != skip) { s += e.getY(i); n++ }; return if (n > 0) s / n else 0f }

    private fun singleTap(x: Float, y: Float) {
        val now = SystemClock.uptimeMillis()
        val dbl = now - lastTapTime < 320 && hypot(x - lastTapX, y - lastTapY) < Theme.dp(40f)
        lastTapTime = now; lastTapX = x; lastTapY = y
        if (dbl) { frameSelection(); return }
        val hit = synchronized(ed.scene) { val (o, d) = uiCam.ray(x, y); Picking.pick(ed.scene, o, d) }
        when {
            hit != null && hit.obj !== ed.scene.selected -> ed.select(hit.obj)
            hit == null && ed.tool == Tool.TRANSFORM -> ed.select(null)
        }
    }

    fun frameSelection() {
        synchronized(ed.scene) {
            val o = ed.scene.selected
            val b = if (o != null && o.visible) o.worldBounds() else ed.scene.bounds()
            if (b != null) uiCam.frame(b.first, b.second)
        }
        ed.requestRender()
    }

    // =========================================================================================
    // brush strokes
    // =========================================================================================
    private inner class Stroke {
        var radiusPx = 50f
        private var obj: SceneObject? = null
        private var lastLocal: Vec3? = null
        private var hitWorld = Vec3()
        private var startLocal = Vec3()
        private var dragLast = Vec3()
        private var localRadius = 0.1f
        private var dabs = 0
        private var selectValue = true
        private val model = FloatArray(16)
        private val inv = FloatArray(16)

        fun hasEffect() = dabs > 2

        private fun brushType(): BrushType? = ed.tool.brush

        fun begin(x: Float, y: Float, pressure: Float): Boolean {
            val (o, d) = synchronized(ed.scene) { uiCam.ray(x, y) }
            val hit = synchronized(ed.scene) {
                val sel = ed.scene.selected
                // prefer the selected object so you can sculpt it even when others overlap
                (if (sel != null && sel.visible) Picking.pick(ed.scene, o, d, sel) else null) ?: Picking.pick(ed.scene, o, d)
            } ?: return false
            if (hit.obj.locked) return false
            if (hit.obj !== ed.scene.selected) ed.select(hit.obj)
            obj = hit.obj
            dabs = 0
            synchronized(ed.scene) {
                hit.obj.localMatrix(model)
                Mat4.invert(model, inv)
                hitWorld = hit.worldPos
                val settings = if (ed.tool == Tool.SELECT) null else ed.currentBrush
                radiusPx = settings?.radiusPx ?: selectRadiusPx
                localRadius = radiusPx * uiCam.worldPerPixel(hit.worldPos) / Mat4.maxScale(model).coerceAtLeast(1e-6f)
                startLocal = hit.localPos
                dragLast = hit.localPos.copy()
                lastLocal = hit.localPos
                if (ed.tool == Tool.SELECT) {
                    ed.faces.bind(hit.obj.mesh)
                    selectValue = !selectNegative
                    ed.faces.paint(hit.localPos, localRadius, selectValue)
                    ed.notify(Change.EDIT_SELECTION)
                    dabs++
                } else {
                    val bt = brushType()!!
                    ed.sculpt.begin(hit.obj, bt, settings!!.also {
                        val lin = app.glbandme.core.scene.Color.hexToLinear(ed.paintColor)
                        it.color[0] = lin[0]; it.color[1] = lin[1]; it.color[2] = lin[2]; it.color[3] = 1f
                    }, localRadius)
                    if (bt == BrushType.MOVE) ed.sculpt.grabStart(hit.localPos, localRadius)
                    else if (bt != BrushType.DRAG) { ed.sculpt.dab(hit.localPos, localRadius, pressure, null); dabs++ }
                }
            }
            ed.requestRender()
            return true
        }

        /** World point under the finger on the plane through the stroke start, facing the camera. */
        private fun planePoint(x: Float, y: Float, through: Vec3): Vec3 {
            val (o, d) = uiCam.ray(x, y)
            val n = uiCam.forward()
            val denom = d.dot(n)
            if (kotlin.math.abs(denom) < 1e-6f) return through
            val t = (through - o).dot(n) / denom
            return o + d * t
        }

        fun move(x: Float, y: Float, pressure: Float) {
            val o = obj ?: return
            val bt = brushType()
            synchronized(ed.scene) {
                when {
                    bt == BrushType.MOVE -> {
                        val p = planePoint(x, y, hitWorld)
                        val worldDelta = p - hitWorld
                        val local = Mat4.transformDir(inv, worldDelta)
                        ed.sculpt.dab(startLocal, localRadius, 1f, local)
                        dabs++
                    }
                    bt == BrushType.DRAG -> {
                        val lastWorld = Mat4.transformPoint(model, dragLast)
                        val p = planePoint(x, y, lastWorld)
                        val local = Mat4.transformDir(inv, p - lastWorld)
                        if (local.length() > localRadius * 0.02f) {
                            ed.sculpt.dab(dragLast, localRadius, pressure, local)
                            dragLast = dragLast + local
                            dabs++
                        }
                    }
                    else -> {
                        val (ro, rd) = uiCam.ray(x, y)
                        val hit = Picking.pick(ed.scene, ro, rd, o, maxStaleMs = 50) ?: return
                        val target = hit.localPos
                        val last = lastLocal ?: target
                        if (ed.tool == Tool.SELECT) {
                            if (ed.faces.paint(target, localRadius, selectValue)) ed.requestRender()
                            lastLocal = target; dabs++
                            return
                        }
                        val spacing = max(localRadius * (ed.currentBrush?.spacing ?: 0.12f), 1e-6f)
                        val dist = target.distance(last)
                        if (dist < spacing) return
                        val steps = (dist / spacing).toInt().coerceAtMost(64)
                        // keep radius consistent with zoom (pixel radius → local)
                        localRadius = radiusPx * uiCam.worldPerPixel(hit.worldPos) / Mat4.maxScale(model).coerceAtLeast(1e-6f)
                        for (s in 1..steps) {
                            val t = s.toFloat() / steps
                            ed.sculpt.dab(last.lerp(target, t), localRadius, pressure, null)
                        }
                        lastLocal = target
                        dabs += steps
                    }
                }
            }
            ed.requestRender()
        }

        fun end() {
            if (obj == null) return
            if (ed.tool == Tool.SELECT) ed.notify(Change.EDIT_SELECTION)
            if (ed.tool != Tool.SELECT) {
                val u = synchronized(ed.scene) { ed.sculpt.end() }
                if (u != null) ed.undo.push(u)
            }
            obj = null
            ed.notify(Change.TOPOLOGY)
        }

        fun cancel() {
            if (obj == null) return
            if (ed.tool != Tool.SELECT) {
                val u = synchronized(ed.scene) { ed.sculpt.end() }
                u?.undo()
            }
            obj = null
            ed.notify(Change.TOPOLOGY)
        }
    }

    var selectRadiusPx = 36f
    var selectNegative = false

    // =========================================================================================
    // EGL config with optional 4x MSAA
    // =========================================================================================
    private class ConfigChooser(private val msaa: Boolean) : EGLConfigChooser {
        override fun chooseConfig(egl: EGL10, display: EGLDisplay): EGLConfig {
            val es3 = 0x40
            fun attempt(samples: Int): EGLConfig? {
                val attribs = intArrayOf(
                    EGL10.EGL_RED_SIZE, 8, EGL10.EGL_GREEN_SIZE, 8, EGL10.EGL_BLUE_SIZE, 8, EGL10.EGL_ALPHA_SIZE, 8,
                    EGL10.EGL_DEPTH_SIZE, 24, EGL10.EGL_RENDERABLE_TYPE, es3,
                    EGL10.EGL_SAMPLE_BUFFERS, if (samples > 0) 1 else 0, EGL10.EGL_SAMPLES, samples,
                    EGL10.EGL_NONE
                )
                val n = IntArray(1)
                if (!egl.eglChooseConfig(display, attribs, null, 0, n) || n[0] <= 0) return null
                val configs = arrayOfNulls<EGLConfig>(n[0])
                egl.eglChooseConfig(display, attribs, configs, n[0], n)
                return configs.firstOrNull()
            }
            return (if (msaa) attempt(4) else null) ?: attempt(0) ?: run {
                // last resort: 16-bit depth
                val attribs = intArrayOf(EGL10.EGL_RED_SIZE, 8, EGL10.EGL_GREEN_SIZE, 8, EGL10.EGL_BLUE_SIZE, 8, EGL10.EGL_DEPTH_SIZE, 16, EGL10.EGL_RENDERABLE_TYPE, es3, EGL10.EGL_NONE)
                val n = IntArray(1); val configs = arrayOfNulls<EGLConfig>(1)
                egl.eglChooseConfig(display, attribs, configs, 1, n)
                configs[0]!!
            }
        }
    }

    @Suppress("unused")
    private fun dist(a: Vec3, b: Vec3) = sqrt((a - b).lengthSq())
}
