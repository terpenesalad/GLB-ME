package app.glbandme.render

import android.graphics.Bitmap
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import app.glbandme.core.scene.Scene
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Headless GL context on its own thread for thumbnails (templates, imports, project cards).
 * Rendering is serialised on that thread.
 */
object OffscreenRenderer {
    private var thread: HandlerThread? = null
    private var handler: Handler? = null
    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var surface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var renderer: SceneRenderer? = null
    private var failed = false

    @Synchronized
    private fun ensureThread(): Handler {
        handler?.let { return it }
        val t = HandlerThread("glbme-offscreen").also { it.start() }
        thread = t
        val h = Handler(t.looper)
        handler = h
        return h
    }

    private fun initEgl(): Boolean {
        if (context != EGL14.EGL_NO_CONTEXT) return true
        if (failed) return false
        try {
            display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
            val ver = IntArray(2)
            if (!EGL14.eglInitialize(display, ver, 0, ver, 1)) { failed = true; return false }
            val attribs = intArrayOf(
                EGL14.EGL_RENDERABLE_TYPE, 0x40 /* EGL_OPENGL_ES3_BIT_KHR */,
                EGL14.EGL_SURFACE_TYPE, EGL14.EGL_PBUFFER_BIT,
                EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
                EGL14.EGL_DEPTH_SIZE, 24,
                EGL14.EGL_NONE
            )
            val configs = arrayOfNulls<EGLConfig>(1)
            val n = IntArray(1)
            if (!EGL14.eglChooseConfig(display, attribs, 0, configs, 0, 1, n, 0) || n[0] == 0) { failed = true; return false }
            context = EGL14.eglCreateContext(display, configs[0], EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE), 0)
            surface = EGL14.eglCreatePbufferSurface(display, configs[0], intArrayOf(EGL14.EGL_WIDTH, 16, EGL14.EGL_HEIGHT, 16, EGL14.EGL_NONE), 0)
            if (!EGL14.eglMakeCurrent(display, surface, surface, context)) { failed = true; return false }
            renderer = SceneRenderer().also { it.init() }
            return true
        } catch (t: Throwable) {
            Log.e("GLB&ME", "Offscreen GL init failed", t)
            failed = true
            return false
        }
    }

    /**
     * Render [scene] (framed automatically unless [frameCamera] is false) to a bitmap. Blocks the
     * caller; never call from the main thread with a large scene.
     */
    fun render(scene: Scene, w: Int, h: Int, frameCamera: Boolean = true, transparent: Boolean = false, timeoutMs: Long = 15000): Bitmap? {
        val latch = CountDownLatch(1)
        var result: Bitmap? = null
        ensureThread().post {
            try {
                if (initEgl()) {
                    val cam = OrbitCamera(scene.camera)
                    cam.fovDeg = scene.render.fov
                    cam.setViewport(w, h)
                    if (frameCamera) scene.bounds()?.let { (a, b) -> cam.frame(a, b, keepAngles = true) }
                    val opt = RenderOptions().apply { transparentBackground = transparent; outlineSelected = false; showMask = false }
                    synchronized(scene) {
                        result = renderer!!.renderToBitmap(scene, cam, w, h, opt)
                    }
                    renderer!!.releaseSceneData()
                }
            } catch (t: Throwable) {
                Log.e("GLB&ME", "Offscreen render failed", t)
            } finally {
                latch.countDown()
            }
        }
        latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        return result
    }
}
