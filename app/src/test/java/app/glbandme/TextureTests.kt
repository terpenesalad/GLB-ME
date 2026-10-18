package app.glbandme

import app.glbandme.core.io.GltfExportOptions
import app.glbandme.core.io.GltfReader
import app.glbandme.core.io.GltfWriter
import app.glbandme.core.mesh.Decal
import app.glbandme.core.mesh.Primitives
import app.glbandme.core.scene.Material
import app.glbandme.core.scene.Scene
import app.glbandme.core.scene.SceneObject
import app.glbandme.core.scene.Texture
import app.glbandme.core.texture.Pattern
import app.glbandme.core.texture.PatternSpec
import app.glbandme.core.texture.TextureGen
import app.glbandme.math.Vec3
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class TextureTests {

    private fun diff(a: Int, b: Int): Int =
        abs(((a shr 16) and 255) - ((b shr 16) and 255)) + abs(((a shr 8) and 255) - ((b shr 8) and 255)) + abs((a and 255) - (b and 255))

    @Test fun everyPatternIsSeamless() {
        val h = FloatArray(1)
        for (p in Pattern.values()) {
            if (p == Pattern.GRADIENT) continue // a gradient is deliberately not periodic in v
            for (scale in listOf(p.defScale, 3f, 5f)) {
                val spec = PatternSpec(p, scale = scale)
                val noise = app.glbandme.core.texture.TileNoise(spec.seed)
                var bad = 0
                for (i in 0 until 400) {
                    val u = (i * 0.6180339f) % 1f; val v = (i * 0.4142135f) % 1f
                    val c0 = TextureGen.sample(spec, noise, u, v, h)
                    if (diff(c0, TextureGen.sample(spec, noise, u + 1f, v, h)) > 6) bad++
                    if (diff(c0, TextureGen.sample(spec, noise, u, v + 1f, h)) > 6) bad++
                    if (diff(c0, TextureGen.sample(spec, noise, u - 1f, v + 2f, h)) > 6) bad++
                }
                assertTrue("$p @ $scale is not periodic ($bad)", bad <= 2)
            }
            val g = TextureGen.generate(PatternSpec(p), 64)
            assertTrue("$p has variation", g.argb.toSet().size > 1)
        }
    }

    @Test fun normalMapOfFlatHeightPointsUp() {
        val n = 16
        val nm = TextureGen.normalMap(FloatArray(n * n) { 0.5f }, n)
        for (c in nm) {
            assertEquals(128, (c shr 16) and 255)
            assertEquals(255, c and 255)
        }
    }

    @Test fun normalMapIsGreenUp() {
        // a ramp rising towards the bottom of the image (increasing rows) -> surface faces "up" (+Y, green > 128)
        val n = 32
        val h = FloatArray(n * n) { i -> (i / n).toFloat() * 0.25f }
        val nm = TextureGen.normalMap(h, n, 4f)
        val c = nm[(n / 2) * n + n / 2]
        assertTrue(((c shr 8) and 255) > 140)
        assertEquals(128, (c shr 16) and 255)
    }

    @Test fun decalWrapsSphereWithinItsBox() {
        val sphere = Primitives.uvSphere(1f, 48, 24)
        val f = Decal.frame(Vec3(0f, 0f, 1f), Vec3(0f, 0f, 1f), Vec3(0f, 1f, 0f), 0f)
        val d = Decal.build(sphere, f, 0.8f, 0.4f, 0.5f, 0.002f)
        assertNotNull(d)
        d!!
        assertTrue(d.triangleCount > 10)
        val uv = d.uvs!!
        for (i in 0 until d.vertexCount) {
            assertTrue(uv[i * 2] in -1e-4f..1.0001f && uv[i * 2 + 1] in -1e-4f..1.0001f)
            val x = d.positions[i * 3]; val y = d.positions[i * 3 + 1]; val z = d.positions[i * 3 + 2]
            assertTrue(abs(x) <= 0.4f + 1e-3f && abs(y) <= 0.2f + 1e-3f)
            // lifted just outside the surface, on the front
            val r = kotlin.math.sqrt(x * x + y * y + z * z)
            assertTrue(r > 0.995f && r < 1.01f && z > 0f)
        }
        // u grows with +x, v grows towards -y (image top is up)
        val i0 = (0 until d.vertexCount).maxByOrNull { d.positions[it * 3] }!!
        assertTrue(uv[i0 * 2] > 0.95f)
        val i1 = (0 until d.vertexCount).maxByOrNull { d.positions[it * 3 + 1] }!!
        assertTrue(uv[i1 * 2 + 1] < 0.05f)
    }

    @Test fun decalOnPlaneCoversExactlyItsArea() {
        val plane = Primitives.plane(4f, 4f, 8) // y-up plane
        val f = Decal.frame(Vec3(0.3f, 0f, 0.2f), Vec3(0f, 1f, 0f), Vec3(0f, 1f, 0f), 30f)
        val d = Decal.build(plane, f, 1f, 0.5f, 0.1f, 0.001f)!!
        var area = 0f
        for (t in 0 until d.triangleCount) {
            val a = d.indices[t * 3]; val b = d.indices[t * 3 + 1]; val c = d.indices[t * 3 + 2]
            val p = d.positions
            val e1 = Vec3(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2])
            val e2 = Vec3(p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2])
            area += e1.cross(e2).length() / 2f
            assertTrue(e1.cross(e2).y > 0f) // same winding as the surface
        }
        assertEquals(0.5f, area, 1e-3f)
    }

    @Test fun textureTransformAndPixelatedRoundTrip() {
        val scene = Scene()
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 9, 9)
        val tex = Texture("bricks", png, "image/png")
        val m = Material(name = "Wall").apply {
            baseColorTexture = tex; normalTexture = tex
            uvScale[0] = 4f; uvScale[1] = 2f; uvOffset[0] = 0.25f; uvRotation = 45f; pixelated = true
        }
        scene.add(SceneObject("Wall", Primitives.box(1f, 1f, 1f, 1).let { app.glbandme.core.mesh.MeshOps.projectUvs(it, app.glbandme.core.mesh.MeshOps.UvProjection.BOX) }, m))
        // a second object with the same image but smooth sampling shares the image, not the texture
        scene.add(SceneObject("Floor", Primitives.plane(1f, 1f, 1).let { app.glbandme.core.mesh.MeshOps.projectUvs(it, app.glbandme.core.mesh.MeshOps.UvProjection.PLANAR_Y) }, Material(name = "Floor").apply { baseColorTexture = tex }))
        val bytes = GltfWriter.write(scene, GltfExportOptions())
        val json = String(bytes, 20, java.nio.ByteBuffer.wrap(bytes).order(java.nio.ByteOrder.LITTLE_ENDIAN).getInt(12))
        assertTrue(json.contains("KHR_texture_transform"))
        assertEquals(1, Regex("\"mimeType\"").findAll(json).count()) // one embedded image
        val back = GltfReader().read(bytes).objects
        val bm = back[0].material
        assertEquals(4f, bm.uvScale[0], 1e-5f); assertEquals(2f, bm.uvScale[1], 1e-5f)
        assertEquals(0.25f, bm.uvOffset[0], 1e-5f)
        assertEquals(45f, bm.uvRotation, 1e-3f)
        assertTrue(bm.pixelated)
        assertTrue(!back[1].material.pixelated)
        assertTrue(!back[1].material.hasUvTransform())
    }

    @Test fun uvMatrixMatchesSpecOrder() {
        // KHR_texture_transform: uv' = T * R * S * uv, R = [[c, s], [-s, c]]
        val m = Material().apply { uvScale[0] = 2f; uvScale[1] = 3f; uvRotation = 90f; uvOffset[0] = 0.5f; uvOffset[1] = 0.25f }
        val k = m.uvMatrix()
        val u = 1f; val v = 0f
        val x = k[0] * u + k[3] * v + k[6]
        val y = k[1] * u + k[4] * v + k[7]
        // S: (2, 0) -> R(90): (c*2 + s*0, -s*2 + c*0) = (0, -2) -> T: (0.5, -1.75)
        assertEquals(0.5f, x, 1e-5f)
        assertEquals(-1.75f, y, 1e-5f)
    }
}
