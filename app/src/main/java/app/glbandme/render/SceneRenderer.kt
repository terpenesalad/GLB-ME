package app.glbandme.render

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.opengl.GLES30.*
import android.opengl.GLUtils
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.scene.AlphaMode
import app.glbandme.core.scene.EnvPreset
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.ShadingMode
import app.glbandme.core.scene.Texture
import app.glbandme.math.Mat4
import app.glbandme.math.MathUtil
import app.glbandme.math.Vec3
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.IdentityHashMap
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.tan

/** Per-frame options from the editor. */
class RenderOptions {
    var transparentBackground = false
    var outlineSelected = true
    var accent = floatArrayOf(0.49f, 0.36f, 1f)
    /** Edit-mode face selection overlay for the selected object: (version, selected triangle ids). */
    var editSelection: Pair<Int, IntArray>? = null
    var editWire = false
    var showMask = true
    var highlightObject: SceneObject? = null
}

/** Renders a [Scene] with OpenGL ES 3.0. All methods must run on a GL thread with a current context. */
class SceneRenderer {
    private lateinit var meshProg: GlUtil.Program
    private lateinit var depthProg: GlUtil.Program
    private lateinit var colorProg: GlUtil.Program
    private lateinit var bgProg: GlUtil.Program
    private lateinit var gridProg: GlUtil.Program
    private var bgVao = 0
    private var gridVao = 0
    private var gridVbo = 0

    private val gpuMeshes = IdentityHashMap<Mesh, GpuMesh>()
    private val textures = HashMap<Long, Int>()
    private val textureUsed = HashMap<Long, Long>()
    private val matcapTex = HashMap<Int, Int>()

    private var shadowFbo = 0
    private var shadowTex = 0
    private val shadowSize = 2048
    private var dummyShadow = 0

    private var frame = 0L
    private var initialized = false

    // scratch
    private val model = FloatArray(16)
    private val normalMat = FloatArray(9)
    private val mvp = FloatArray(16)
    private val lightVP = FloatArray(16)
    private val lightDirs = FloatArray(9)
    private val lightCols = FloatArray(9)

    fun init() {
        meshProg = GlUtil.Program(Shaders.MESH_VS, Shaders.MESH_FS)
        depthProg = GlUtil.Program(Shaders.DEPTH_VS, Shaders.DEPTH_FS)
        colorProg = GlUtil.Program(Shaders.COLOR_VS, Shaders.COLOR_FS)
        bgProg = GlUtil.Program(Shaders.BG_VS, Shaders.BG_FS)
        gridProg = GlUtil.Program(Shaders.GRID_VS, Shaders.GRID_FS)
        bgVao = GlUtil.genVao()
        gridVao = GlUtil.genVao()
        gridVbo = GlUtil.genBuffer()
        glBindVertexArray(gridVao)
        glBindBuffer(GL_ARRAY_BUFFER, gridVbo)
        val q = floatArrayOf(-1f, 0f, -1f, 1f, 0f, -1f, 1f, 0f, 1f, -1f, 0f, -1f, 1f, 0f, 1f, -1f, 0f, 1f)
        glBufferData(GL_ARRAY_BUFFER, q.size * 4, GlUtil.floatBuffer(q), GL_STATIC_DRAW)
        glVertexAttribPointer(0, 3, GL_FLOAT, false, 0, 0)
        glEnableVertexAttribArray(0)
        glBindVertexArray(0)
        glBindBuffer(GL_ARRAY_BUFFER, 0)
        createShadowTargets()
        initialized = true
        GlUtil.check("init")
    }

    private fun depthTexture(size: Int): Int {
        val t = GlUtil.genTexture()
        glBindTexture(GL_TEXTURE_2D, t)
        glTexImage2D(GL_TEXTURE_2D, 0, GL_DEPTH_COMPONENT24, size, size, 0, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, null)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_MODE, GL_COMPARE_REF_TO_TEXTURE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_COMPARE_FUNC, GL_LEQUAL)
        return t
    }

    private fun createShadowTargets() {
        shadowTex = depthTexture(shadowSize)
        shadowFbo = GlUtil.genFramebuffer()
        glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo)
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_TEXTURE_2D, shadowTex, 0)
        glDrawBuffers(1, intArrayOf(GL_NONE), 0)
        glReadBuffer(GL_NONE)
        if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) {
            glDeleteFramebuffers(1, intArrayOf(shadowFbo), 0); shadowFbo = 0
        }
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        dummyShadow = depthTexture(1)
    }

    fun gpu(m: Mesh): GpuMesh = gpuMeshes.getOrPut(m) { GpuMesh(m) }.also { it.lastUsedFrame = frame }

    private fun texture(t: Texture?): Int {
        if (t == null) return 0
        textureUsed[t.uid] = frame
        textures[t.uid]?.let { return it }
        var bmp: Bitmap? = null
        try {
            val opts = BitmapFactory.Options().apply { inPremultiplied = false; inPreferredConfig = Bitmap.Config.ARGB_8888 }
            bmp = BitmapFactory.decodeByteArray(t.bytes, 0, t.bytes.size, opts)
        } catch (_: Throwable) {}
        val id = GlUtil.genTexture()
        glBindTexture(GL_TEXTURE_2D, id)
        if (bmp != null) {
            var b: Bitmap = bmp
            val maxSize = 4096
            if (b.width > maxSize || b.height > maxSize) {
                val s = maxSize.toFloat() / max(b.width, b.height)
                b = Bitmap.createScaledBitmap(b, (b.width * s).toInt(), (b.height * s).toInt(), true)
            }
            GLUtils.texImage2D(GL_TEXTURE_2D, 0, b, 0)
            glGenerateMipmap(GL_TEXTURE_2D)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR_MIPMAP_LINEAR)
            if (b !== bmp) b.recycle()
            bmp.recycle()
        } else {
            val px = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder())
            px.put(byteArrayOf(-1, 0, -1, -1)).position(0)
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, px)
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        }
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT)
        textures[t.uid] = id
        return id
    }

    private fun matcap(index: Int): Int = matcapTex.getOrPut(index) {
        val id = GlUtil.genTexture()
        glBindTexture(GL_TEXTURE_2D, id)
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, Matcaps.SIZE, Matcaps.SIZE, 0, GL_RGBA, GL_UNSIGNED_BYTE, Matcaps.pixels(index))
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE)
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE)
        id
    }

    private fun hexLin(hex: Int): FloatArray {
        fun c(v: Int) = (v / 255f).pow(2.2f)
        return floatArrayOf(c((hex shr 16) and 255), c((hex shr 8) and 255), c(hex and 255))
    }

    private fun setupLights(scene: Scene) {
        val r = scene.render
        val az = r.lightAngle * MathUtil.DEG
        val el = r.lightHeight * MathUtil.DEG
        fun dir(i: Int, a: Float, e: Float) {
            lightDirs[i * 3] = cos(e) * sin(a); lightDirs[i * 3 + 1] = sin(e); lightDirs[i * 3 + 2] = cos(e) * cos(a)
        }
        dir(0, az, el)
        dir(1, az + 2.4f, 0.35f)
        dir(2, az + 3.5f, 0.6f)
        val (k, f, rim) = when (r.env) {
            EnvPreset.STUDIO -> Triple(floatArrayOf(2.9f, 2.8f, 2.65f), floatArrayOf(0.55f, 0.6f, 0.72f), floatArrayOf(1.3f, 1.3f, 1.4f))
            EnvPreset.SUNSET -> Triple(floatArrayOf(3.2f, 1.9f, 1.0f), floatArrayOf(0.35f, 0.3f, 0.6f), floatArrayOf(1.6f, 0.8f, 0.5f))
            EnvPreset.NIGHT -> Triple(floatArrayOf(1.2f, 1.35f, 1.9f), floatArrayOf(0.12f, 0.15f, 0.3f), floatArrayOf(0.7f, 0.8f, 1.4f))
            EnvPreset.OVERCAST -> Triple(floatArrayOf(1.3f, 1.3f, 1.35f), floatArrayOf(0.5f, 0.5f, 0.52f), floatArrayOf(0.4f, 0.4f, 0.42f))
            EnvPreset.NEON -> Triple(floatArrayOf(2.6f, 0.6f, 2.2f), floatArrayOf(0.1f, 0.6f, 0.9f), floatArrayOf(0.2f, 1.6f, 1.8f))
        }
        k.copyInto(lightCols, 0); f.copyInto(lightCols, 3); rim.copyInto(lightCols, 6)
    }

    private fun envColors(scene: Scene): Triple<FloatArray, FloatArray, FloatArray> = when (scene.render.env) {
        EnvPreset.STUDIO -> Triple(floatArrayOf(0.62f, 0.66f, 0.74f), floatArrayOf(0.42f, 0.42f, 0.45f), floatArrayOf(0.13f, 0.12f, 0.12f))
        EnvPreset.SUNSET -> Triple(floatArrayOf(0.35f, 0.38f, 0.65f), floatArrayOf(0.95f, 0.55f, 0.32f), floatArrayOf(0.14f, 0.1f, 0.1f))
        EnvPreset.NIGHT -> Triple(floatArrayOf(0.06f, 0.08f, 0.18f), floatArrayOf(0.1f, 0.12f, 0.2f), floatArrayOf(0.03f, 0.03f, 0.04f))
        EnvPreset.OVERCAST -> Triple(floatArrayOf(0.8f, 0.82f, 0.85f), floatArrayOf(0.62f, 0.63f, 0.65f), floatArrayOf(0.2f, 0.2f, 0.2f))
        EnvPreset.NEON -> Triple(floatArrayOf(0.15f, 0.05f, 0.3f), floatArrayOf(0.4f, 0.1f, 0.5f), floatArrayOf(0.02f, 0.05f, 0.08f))
    }

    private fun computeLightVP(scene: Scene): Boolean {
        val b = scene.bounds() ?: return false
        val lo = b.first.copy(); val hi = b.second.copy()
        lo.y = minOf(lo.y, 0f); hi.y = max(hi.y, 0f)
        val c = (lo + hi) * 0.5f
        val r = max((hi - lo).length() * 0.6f, 0.05f)
        val d = Vec3(lightDirs[0], lightDirs[1], lightDirs[2])
        val eye = c + d * (r * 2f)
        val up = if (kotlin.math.abs(d.y) > 0.95f) Vec3(0f, 0f, 1f) else Vec3(0f, 1f, 0f)
        val view = Mat4.lookAt(eye, c, up)
        val proj = Mat4.ortho(-r, r, -r, r, r * 0.05f, r * 4f)
        Mat4.mul(proj, view, lightVP)
        return true
    }

    private fun det(m: FloatArray) = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2])

    /**
     * Draw the scene into the currently bound framebuffer of size w x h.
     * Caller must hold the scene lock.
     */
    fun render(scene: Scene, cam: OrbitCamera, w: Int, h: Int, opt: RenderOptions, targetFbo: Int = 0) {
        if (!initialized) init()
        frame++
        val rs = scene.render
        cam.fovDeg = rs.fov
        cam.ortho = rs.orthographic
        cam.setViewport(w, h)
        cam.update()
        setupLights(scene)
        val visible = scene.objects.filter { it.visible && it.mesh.triangleCount > 0 }
        for (o in visible) gpu(o.mesh).sync()

        // ---- shadow pass --------------------------------------------------------------------
        val shadows = rs.shadows && shadowFbo != 0 && rs.shading != ShadingMode.NORMALS && computeLightVP(scene)
        if (shadows) {
            glBindFramebuffer(GL_FRAMEBUFFER, shadowFbo)
            glViewport(0, 0, shadowSize, shadowSize)
            glClear(GL_DEPTH_BUFFER_BIT)
            glEnable(GL_DEPTH_TEST)
            glDepthMask(true)
            glColorMask(false, false, false, false)
            glDisable(GL_CULL_FACE)
            glEnable(GL_POLYGON_OFFSET_FILL)
            glPolygonOffset(2f, 4f)
            depthProg.use()
            for (o in visible) {
                if (o.material.alphaMode == AlphaMode.BLEND && o.material.baseColor[3] < 0.5f) continue
                o.localMatrix(model)
                Mat4.mul(lightVP, model, mvp)
                depthProg.setMat4("uMVP", mvp)
                gpu(o.mesh).drawTriangles()
            }
            glDisable(GL_POLYGON_OFFSET_FILL)
            glColorMask(true, true, true, true)
        }

        glBindFramebuffer(GL_FRAMEBUFFER, targetFbo)
        glViewport(0, 0, w, h)
        glClearColor(0f, 0f, 0f, 0f)
        glDepthMask(true)
        glClear(GL_COLOR_BUFFER_BIT or GL_DEPTH_BUFFER_BIT)

        // ---- background -----------------------------------------------------------------------
        glDisable(GL_DEPTH_TEST)
        glDisable(GL_CULL_FACE)
        if (!opt.transparentBackground) {
            bgProg.use()
            fun c(hex: Int, s: Int) = ((hex shr s) and 255) / 255f
            bgProg.set3f("uTop", c(rs.bgTop, 16), c(rs.bgTop, 8), c(rs.bgTop, 0))
            bgProg.set3f("uBottom", c(rs.bgBottom, 16), c(rs.bgBottom, 8), c(rs.bgBottom, 0))
            bgProg.set1f("uTransparent", 0f)
            glBindVertexArray(bgVao)
            glDrawArrays(GL_TRIANGLES, 0, 3)
            glBindVertexArray(0)
        }
        glEnable(GL_DEPTH_TEST)
        glDepthFunc(GL_LEQUAL)

        val (sky, horizon, ground) = envColors(scene)
        val selected = scene.selected

        // ---- selection outline ----------------------------------------------------------------
        if (opt.outlineSelected && selected != null && selected.visible && selected.mesh.triangleCount > 0) {
            colorProg.use()
            colorProg.setMat4("uViewProj", cam.viewProj)
            selected.localMatrix(model)
            colorProg.setMat4("uModel", model)
            colorProg.setMat3("uNormalMat", Mat4.normalMatrix(model, normalMat))
            val px = 2.2f * (h / 1000f).coerceAtLeast(1f)
            val inflate = if (cam.ortho) px * cam.worldPerPixel(selected.position) else px * 2f * tan(rs.fov * MathUtil.DEG / 2f) / h
            colorProg.set1f("uInflate", inflate)
            colorProg.set4f("uColor", opt.accent[0], opt.accent[1], opt.accent[2], 1f)
            glEnable(GL_CULL_FACE)
            glCullFace(GL_FRONT)
            glFrontFace(if (det(model) < 0) GL_CW else GL_CCW)
            glDepthMask(true)
            gpu(selected.mesh).drawTriangles()
            glCullFace(GL_BACK)
            glFrontFace(GL_CCW)
            glDisable(GL_CULL_FACE)
        }

        // ---- meshes ---------------------------------------------------------------------------
        meshProg.use()
        meshProg.setMat4("uViewProj", cam.viewProj)
        meshProg.setMat4("uView", cam.view)
        meshProg.set3f("uCamPos", cam.eye.x, cam.eye.y, cam.eye.z)
        meshProg.set3fv("uLightDir", lightDirs, 3)
        meshProg.set3fv("uLightColor", lightCols, 3)
        meshProg.set3f("uSky", sky[0], sky[1], sky[2])
        meshProg.set3f("uHorizon", horizon[0], horizon[1], horizon[2])
        meshProg.set3f("uGround", ground[0], ground[1], ground[2])
        meshProg.set1f("uExposure", rs.exposure)
        meshProg.set1i("uMode", when (rs.shading) { ShadingMode.PBR -> 0; ShadingMode.MATCAP -> 1; ShadingMode.FLAT_CLAY -> 2; ShadingMode.NORMALS -> 3; ShadingMode.UNLIT -> 4 })
        meshProg.setMat4("uLightVP", lightVP)
        meshProg.set1i("uShadows", if (shadows) 1 else 0)
        meshProg.set1f("uShadowTexel", 1f / shadowSize)
        meshProg.set1f("uMaskShow", if (opt.showMask) 1f else 0f)
        // texture units: 0 base, 1 mr, 2 normal, 3 emissive, 4 occ, 5 matcap, 6 shadow
        meshProg.set1i("uBaseTex", 0); meshProg.set1i("uMRTex", 1); meshProg.set1i("uNormalTex", 2)
        meshProg.set1i("uEmissiveTex", 3); meshProg.set1i("uOccTex", 4); meshProg.set1i("uMatcap", 5); meshProg.set1i("uShadowMap", 6)
        glActiveTexture(GL_TEXTURE5); glBindTexture(GL_TEXTURE_2D, matcap(rs.matcap))
        glActiveTexture(GL_TEXTURE6); glBindTexture(GL_TEXTURE_2D, if (shadows) shadowTex else dummyShadow)

        val wire = rs.wireframe
        val opaque = visible.filter { it.material.alphaMode != AlphaMode.BLEND || rs.shading == ShadingMode.MATCAP || rs.shading == ShadingMode.NORMALS }
        val transparent = visible.filter { it !in opaque }.sortedByDescending { o ->
            val p = o.position; (p - cam.eye).lengthSq()
        }
        glDisable(GL_BLEND)
        if (wire) { glEnable(GL_POLYGON_OFFSET_FILL); glPolygonOffset(1f, 1f) }
        for (o in opaque) drawMesh(o, opt, false)
        glDisable(GL_POLYGON_OFFSET_FILL)

        // ---- ground grid + contact shadows ----------------------------------------------------
        if (rs.showGrid || shadows) drawGrid(scene, cam, shadows)

        // ---- transparent ----------------------------------------------------------------------
        if (transparent.isNotEmpty()) {
            meshProg.use()
            glEnable(GL_BLEND)
            glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA)
            glDepthMask(false)
            glActiveTexture(GL_TEXTURE5); glBindTexture(GL_TEXTURE_2D, matcap(rs.matcap))
            glActiveTexture(GL_TEXTURE6); glBindTexture(GL_TEXTURE_2D, if (shadows) shadowTex else dummyShadow)
            for (o in transparent) drawMesh(o, opt, true)
            glDepthMask(true)
            glDisable(GL_BLEND)
        }

        // ---- wireframe ------------------------------------------------------------------------
        val wireObjects = if (wire) visible else if (opt.editWire && selected != null && selected.visible) listOf(selected) else emptyList()
        if (wireObjects.isNotEmpty()) {
            colorProg.use()
            colorProg.setMat4("uViewProj", cam.viewProj)
            colorProg.set1f("uInflate", 0f)
            glEnable(GL_BLEND)
            glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
            glDepthMask(false)
            for (o in wireObjects) {
                o.localMatrix(model)
                colorProg.setMat4("uModel", model)
                colorProg.setMat3("uNormalMat", Mat4.normalMatrix(model, normalMat))
                if (o === selected && opt.editWire) colorProg.set4f("uColor", 1f, 1f, 1f, 0.35f)
                else colorProg.set4f("uColor", 0.05f, 0.05f, 0.08f, 0.45f)
                gpu(o.mesh).drawEdges()
            }
            glDepthMask(true)
            glDisable(GL_BLEND)
        }

        // ---- edit-mode face selection ---------------------------------------------------------
        val sel = opt.editSelection
        if (sel != null && selected != null && selected.visible) {
            val g = gpu(selected.mesh)
            g.syncSelection(sel.first, sel.second)
            if (g.selCount > 0) {
                colorProg.use()
                colorProg.setMat4("uViewProj", cam.viewProj)
                selected.localMatrix(model)
                colorProg.setMat4("uModel", model)
                colorProg.setMat3("uNormalMat", Mat4.normalMatrix(model, normalMat))
                colorProg.set1f("uInflate", 0f)
                colorProg.set4f("uColor", 1f, 0.55f, 0.15f, 0.45f)
                glEnable(GL_BLEND)
                glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA)
                glEnable(GL_POLYGON_OFFSET_FILL)
                glPolygonOffset(-1f, -2f)
                glDepthMask(false)
                g.drawSelection()
                glDepthMask(true)
                glDisable(GL_POLYGON_OFFSET_FILL)
                glDisable(GL_BLEND)
            }
        }
        glBindVertexArray(0)
        GlUtil.check("render")
        if (frame % 120L == 0L) collectGarbage()
    }

    private fun drawMesh(o: SceneObject, opt: RenderOptions, blend: Boolean) {
        val m = o.material
        o.localMatrix(model)
        val p = meshProg
        p.setMat4("uModel", model)
        p.setMat3("uNormalMat", Mat4.normalMatrix(model, normalMat))
        p.set4f("uBaseColor", m.baseColor[0], m.baseColor[1], m.baseColor[2], m.baseColor[3])
        p.set1f("uMetallic", m.metallic)
        p.set1f("uRoughness", m.roughness)
        val es = m.emissiveStrength
        p.set3f("uEmissive", m.emissive[0] * es, m.emissive[1] * es, m.emissive[2] * es)
        p.set1i("uAlphaMode", if (blend) 2 else if (m.alphaMode == AlphaMode.MASK) 1 else 0)
        p.set1f("uAlphaCutoff", m.alphaCutoff)
        p.set1i("uUnlit", if (m.unlit) 1 else 0)
        p.set1i("uFlat", 0)
        val g = gpu(o.mesh)
        p.set1i("uUseVertexColor", if (g.hasColors) 1 else 0)
        fun bind(unit: Int, t: Texture?, flag: String): Boolean {
            val id = if (g.hasUvs) texture(t) else 0
            p.set1i(flag, if (id != 0) 1 else 0)
            if (id != 0) { glActiveTexture(GL_TEXTURE0 + unit); glBindTexture(GL_TEXTURE_2D, id) }
            return id != 0
        }
        bind(0, m.baseColorTexture, "uHasBaseTex")
        bind(1, m.metallicRoughnessTexture, "uHasMRTex")
        bind(2, m.normalTexture, "uHasNormalTex")
        bind(3, m.emissiveTexture, "uHasEmissiveTex")
        bind(4, m.occlusionTexture, "uHasOccTex")
        p.set1f("uNormalScale", m.normalScale)
        p.set1f("uOccStrength", m.occlusionStrength)
        if (opt.highlightObject === o) p.set4f("uTint", opt.accent[0], opt.accent[1], opt.accent[2], 0.25f)
        else p.set4f("uTint", 0f, 0f, 0f, 0f)
        if (m.doubleSided || blend) glDisable(GL_CULL_FACE) else { glEnable(GL_CULL_FACE); glCullFace(GL_BACK) }
        glFrontFace(if (det(model) < 0) GL_CW else GL_CCW)
        g.drawTriangles()
        glFrontFace(GL_CCW)
    }

    private fun drawGrid(scene: Scene, cam: OrbitCamera, shadows: Boolean) {
        val rs = scene.render
        val dist = cam.state.distance
        val sceneR = scene.bounds()?.let { (a, b) -> (b - a).length() } ?: 1f
        val extent = max(dist * 10f, sceneR * 4f)
        val scale = 10f.pow(floor(log10(max(dist, 1e-3f)))) / 10f
        gridProg.use()
        gridProg.setMat4("uViewProj", cam.viewProj)
        gridProg.setMat4("uLightVP", lightVP)
        gridProg.set1f("uExtent", extent)
        gridProg.set2f("uCenter", cam.state.target.x, cam.state.target.z)
        gridProg.set3f("uCamPos", cam.eye.x, cam.eye.y, cam.eye.z)
        gridProg.set1f("uScale", scale)
        gridProg.set1f("uFade", extent * 0.8f)
        gridProg.set1i("uShowGrid", if (rs.showGrid) 1 else 0)
        gridProg.set1i("uShadows", if (shadows) 1 else 0)
        gridProg.set1f("uShadowTexel", 1f / shadowSize)
        gridProg.set1i("uShadowMap", 6)
        val bright = ((rs.bgTop shr 8) and 255) > 160
        if (bright) gridProg.set3f("uLineColor", 0.15f, 0.15f, 0.18f) else gridProg.set3f("uLineColor", 0.75f, 0.77f, 0.85f)
        glActiveTexture(GL_TEXTURE6); glBindTexture(GL_TEXTURE_2D, if (shadows) shadowTex else dummyShadow)
        glEnable(GL_BLEND)
        glBlendFuncSeparate(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA, GL_ONE, GL_ONE_MINUS_SRC_ALPHA)
        glDepthMask(false)
        glDisable(GL_CULL_FACE)
        glBindVertexArray(gridVao)
        glDrawArrays(GL_TRIANGLES, 0, 6)
        glBindVertexArray(0)
        glDepthMask(true)
        glDisable(GL_BLEND)
    }

    private fun collectGarbage() {
        val it = gpuMeshes.entries.iterator()
        while (it.hasNext()) {
            val e = it.next()
            if (frame - e.value.lastUsedFrame > 240) { e.value.release(); it.remove() }
        }
        val dead = textureUsed.filter { frame - it.value > 600 }.keys
        for (k in dead) { textures.remove(k)?.let { GlUtil.deleteTexture(it) }; textureUsed.remove(k) }
    }

    /** Free per-scene GPU data but keep programs (used by the offscreen renderer between jobs). */
    fun releaseSceneData() {
        for (g in gpuMeshes.values) g.release()
        gpuMeshes.clear()
        for (t in textures.values) GlUtil.deleteTexture(t)
        textures.clear(); textureUsed.clear()
    }

    /** Free everything (context lost / destroyed). */
    fun release() {
        for (g in gpuMeshes.values) g.release()
        gpuMeshes.clear()
        for (t in textures.values) GlUtil.deleteTexture(t)
        textures.clear()
        for (t in matcapTex.values) GlUtil.deleteTexture(t)
        matcapTex.clear()
        initialized = false
    }

    /** Forget GL objects without deleting (after the context was destroyed by the system). */
    fun contextLost() {
        gpuMeshes.clear(); textures.clear(); textureUsed.clear(); matcapTex.clear(); initialized = false
    }

    // -------------------------------------------------------------------------------------------
    // offscreen capture
    // -------------------------------------------------------------------------------------------
    /** Render to an offscreen target and read back as a Bitmap (thumbnails, screenshots). */
    fun renderToBitmap(scene: Scene, cam: OrbitCamera, w: Int, h: Int, opt: RenderOptions, supersample: Int = 2): Bitmap {
        val rw = w * supersample; val rh = h * supersample
        val maxSize = IntArray(1); glGetIntegerv(GL_MAX_RENDERBUFFER_SIZE, maxSize, 0)
        val s = minOf(1f, maxSize[0].toFloat() / max(rw, rh))
        val fw = (rw * s).toInt(); val fh = (rh * s).toInt()
        val fbo = GlUtil.genFramebuffer()
        val color = GlUtil.genRenderbuffer()
        val depth = GlUtil.genRenderbuffer()
        glBindRenderbuffer(GL_RENDERBUFFER, color)
        glRenderbufferStorage(GL_RENDERBUFFER, GL_RGBA8, fw, fh)
        glBindRenderbuffer(GL_RENDERBUFFER, depth)
        glRenderbufferStorage(GL_RENDERBUFFER, GL_DEPTH_COMPONENT24, fw, fh)
        glBindFramebuffer(GL_FRAMEBUFFER, fbo)
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, color)
        glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_DEPTH_ATTACHMENT, GL_RENDERBUFFER, depth)
        render(scene, cam, fw, fh, opt, fbo)
        glBindFramebuffer(GL_FRAMEBUFFER, fbo)
        val buf = ByteBuffer.allocateDirect(fw * fh * 4).order(ByteOrder.nativeOrder())
        glReadPixels(0, 0, fw, fh, GL_RGBA, GL_UNSIGNED_BYTE, buf)
        glBindFramebuffer(GL_FRAMEBUFFER, 0)
        glDeleteFramebuffers(1, intArrayOf(fbo), 0)
        glDeleteRenderbuffers(2, intArrayOf(color, depth), 0)
        val big = Bitmap.createBitmap(fw, fh, Bitmap.Config.ARGB_8888)
        buf.position(0)
        big.copyPixelsFromBuffer(buf)
        // GL origin is bottom-left: flip vertically while scaling down
        val m = android.graphics.Matrix().apply { postScale(w.toFloat() / fw, -h.toFloat() / fh); postTranslate(0f, h.toFloat()) }
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = android.graphics.Canvas(out)
        c.drawBitmap(big, m, android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))
        big.recycle()
        return out
    }
}
