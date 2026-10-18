package app.glbandme.ui

import android.app.Activity
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowInsets
import android.view.WindowManager
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class Insets(val left: Int, val top: Int, val right: Int, val bottom: Int, val ime: Int = 0)

/** Edge-to-edge dark activity with background job helpers. */
abstract class BaseActivity : Activity() {
    protected val main = Handler(Looper.getMainLooper())
    var insets = Insets(0, 0, 0, 0); private set
    private val insetListeners = ArrayList<(Insets) -> Unit>()

    private var themeVersion = -1
    /** Screens that can simply be rebuilt when text / interface size changes. */
    protected open val rebuildOnThemeChange = true

    override fun onResume() {
        super.onResume()
        Theme.load(this)
        if (themeVersion >= 0 && themeVersion != Theme.version && rebuildOnThemeChange) { themeVersion = Theme.version; recreate(); return }
        themeVersion = Theme.version
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Theme.load(this)
        themeVersion = Theme.version
        window.statusBarColor = Color.TRANSPARENT
        window.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
        }
        if (Build.VERSION.SDK_INT >= 28) window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (Build.VERSION.SDK_INT >= 29) { window.isNavigationBarContrastEnforced = false; window.isStatusBarContrastEnforced = false }
        window.setBackgroundDrawableResource(android.R.color.black)
    }

    /** Call with the root view once; listeners get system bar insets. */
    protected fun trackInsets(root: View) {
        root.setOnApplyWindowInsetsListener { _, wi ->
            insets = if (Build.VERSION.SDK_INT >= 30) {
                val i = wi.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                Insets(i.left, i.top, i.right, i.bottom, wi.getInsets(WindowInsets.Type.ime()).bottom)
            } else {
                @Suppress("DEPRECATION")
                Insets(wi.systemWindowInsetLeft, wi.systemWindowInsetTop, wi.systemWindowInsetRight, wi.systemWindowInsetBottom)
            }
            for (l in insetListeners) l(insets)
            wi
        }
        root.requestApplyInsets()
    }

    protected fun onInsets(l: (Insets) -> Unit) { insetListeners.add(l); l(insets) }

    fun ui(block: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post { if (!isFinishing && !isDestroyed) block() } }

    companion object {
        val bg: ExecutorService = Executors.newFixedThreadPool(2) { r -> Thread(r, "glbme-bg").apply { priority = Thread.NORM_PRIORITY - 1 } }
    }

    /** Run [work] off the main thread, then deliver result/failure on the main thread. */
    fun <T> async(work: () -> T, onError: (Throwable) -> Unit = { showError(it) }, done: (T) -> Unit) {
        bg.execute {
            val r = runCatching(work)
            ui { r.fold(done, onError) }
        }
    }

    open fun showError(t: Throwable) {
        android.util.Log.e("GLB&ME", "error", t)
        Dialogs.message(this, "Something went wrong", t.message ?: t.javaClass.simpleName)
    }
}
