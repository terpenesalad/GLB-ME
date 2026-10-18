package app.glbandme.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import app.glbandme.core.templates.Template
import app.glbandme.core.templates.Templates
import app.glbandme.ui.Theme.dp
import java.io.File

/** Gallery of procedural starter scenes. */
class TemplatesActivity : BaseActivity() {
    private lateinit var grid: LinearLayout
    private var category = "All"
    private val chips = ArrayList<Chip>()
    private val cache = HashMap<String, Bitmap>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this).apply { background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(0xFF102030.toInt(), Theme.BG, Theme.BG)) }
        val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false }
        val content = vbox()
        scroll.addView(content)
        root.addView(scroll, flp(MATCH, MATCH))
        setContentView(root)
        trackInsets(root)
        onInsets { i -> content.setPadding(dp(16) + i.left, i.top + dp(8), dp(16) + i.right, i.bottom + dp(24)) }

        val header = hbox().apply { setPadding(0, 0, 0, dp(8)) }
        header.addView(IconButton(this, Icon.BACK).apply { onClick = { finish() } })
        val t = vbox().apply { setPadding(dp(6), 0, 0, 0) }
        t.addView(label("Templates", 22f, Theme.TEXT, bold = true))
        t.addView(label("Fully editable starting points – every part stays a separate object", 12.5f, Theme.TEXT_DIM).apply { setPadding(0, dp(3), 0, 0) })
        header.addView(t, lp(0, WRAP, 1f))
        content.addView(header)

        val row = hbox(0, 8).apply { setPadding(0, dp(10), 0, dp(14)) }
        for (c in Templates.categories) {
            val chip = Chip(this, c).apply { active = c == category; onClick = { category = c; chips.forEach { it.active = it.text == c }; fill() } }
            chips.add(chip)
            row.addView(chip)
        }
        content.addView(hscroll(row))
        grid = vbox(0, 12)
        content.addView(grid)
        fill()
    }

    private fun columns(): Int {
        val wdp = resources.displayMetrics.widthPixels / resources.displayMetrics.density
        return when { wdp >= 900 -> 4; wdp >= 600 -> 3; else -> 2 }
    }

    private fun fill() {
        grid.removeAllViews()
        val list = Templates.all.filter { category == "All" || it.category == category }
        val cols = columns()
        var row: LinearLayout? = null
        list.forEachIndexed { i, t ->
            if (i % cols == 0) { row = hbox(0, 12); grid.addView(row, lp()) }
            row!!.addView(card(t), lp(0, WRAP, 1f))
        }
        val rem = list.size % cols
        if (rem != 0) repeat(cols - rem) { row!!.addView(View(this), lp(0, 1, 1f)) }
    }

    private fun thumbFile(t: Template) = File(cacheDir, "tpl_thumbs/${t.id}-v3.png")

    private fun card(t: Template): ThumbCard {
        val c = ThumbCard(this)
        c.title = t.name
        c.subtitle = t.description
        c.badge = if (t.animated) "▶ Animated" else t.category
        c.placeholderIcon = Icon.TEMPLATES
        val cached = cache[t.id]
        if (cached != null) c.thumb = cached else {
            c.loading = true
            async({
                val f = thumbFile(t)
                if (f.exists()) BitmapFactory.decodeFile(f.absolutePath)
                else {
                    val bmp = SceneFactory.thumbnail(t.build(), 384)
                    if (bmp != null) { f.parentFile?.mkdirs(); f.outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 92, it) } }
                    bmp
                }
            }, onError = { c.loading = false }) { b -> c.loading = false; if (b != null) { cache[t.id] = b; c.thumb = b } }
        }
        c.onClick = { SceneFactory.createAndOpen(this, t.name) { t.build().also { SceneFactory.frame(it) } } }
        return c
    }
}
