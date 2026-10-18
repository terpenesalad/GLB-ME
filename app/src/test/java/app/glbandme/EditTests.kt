package app.glbandme

import app.glbandme.core.edit.FaceSelection
import app.glbandme.core.mesh.Mesh
import app.glbandme.core.mesh.MeshOps
import app.glbandme.core.mesh.Primitives
import app.glbandme.math.Vec3
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EditTests {
    private fun volume(m: Mesh): Float {
        var v = 0f
        val p = m.positions
        for (t in 0 until m.triangleCount) {
            val a = Vec3.of(p, m.indices[t * 3] * 3); val b = Vec3.of(p, m.indices[t * 3 + 1] * 3); val c = Vec3.of(p, m.indices[t * 3 + 2] * 3)
            v += a.dot(b.cross(c)) / 6f
        }
        return v
    }

    private fun topFaces(m: Mesh, sel: FaceSelection) {
        for (t in 0 until m.triangleCount) {
            var top = true
            for (k in 0 until 3) if (m.positions[m.indices[t * 3 + k] * 3 + 1] < 0.499f) top = false
            if (top) sel.set(t, true)
        }
    }

    @Test fun extrudeTopOfCubeAddsVolumeWithOutwardWalls() {
        val cube = MeshOps.weld(Primitives.box(1f, 1f, 1f, 1))
        assertEquals(1f, volume(cube), 1e-4f)
        val sel = FaceSelection(); sel.bind(cube)
        topFaces(cube, sel)
        assertEquals(2, sel.count)
        val (m, newSel) = sel.extrude(0.5f)!!
        assertEquals(1.5f, volume(m), 1e-4f)
        assertEquals(m.triangleCount, newSel.size)
        assertEquals(2, newSel.count { it })
        // walls must face outward: every triangle normal points away from the box axis
        for (t in 0 until m.triangleCount) {
            val p = m.positions
            val a = Vec3.of(p, m.indices[t * 3] * 3); val b = Vec3.of(p, m.indices[t * 3 + 1] * 3); val c = Vec3.of(p, m.indices[t * 3 + 2] * 3)
            val n = (b - a).cross(c - a)
            if (n.lengthSq() < 1e-12f) continue
            val center = (a + b + c) / 3f - Vec3(0f, 0.25f, 0f)
            assertTrue("tri $t inward", n.dot(center) > 0f)
        }
    }

    @Test fun extrudeOnSeamedCubeKeepsWatertight() {
        val cube = Primitives.box(1f, 1f, 1f, 2)
        val sel = FaceSelection(); sel.bind(cube)
        topFaces(cube, sel)
        val (m, _) = sel.extrude(0.3f)!!
        assertEquals(1.3f, volume(m), 1e-3f)
    }

    @Test fun deleteExtractFlipInset() {
        val s = Primitives.uvSphere(1f, 16, 8)
        val sel = FaceSelection(); sel.bind(s)
        sel.paint(Vec3(0f, 0f, 1f), 0.5f, true)
        assertTrue(sel.count > 0)
        val n = sel.count
        val del = sel.deleteFaces()!!
        assertEquals(s.triangleCount - n, del.triangleCount)
        assertEquals(n, sel.extract()!!.triangleCount)
        assertNotNull(sel.flipFaces())
        val (ins, isel) = sel.inset(0.3f)!!
        assertTrue(ins.triangleCount > s.triangleCount)
        assertEquals(n, isel.count { it })
        sel.grow(); assertTrue(sel.count > n)
        sel.clear(); sel.set(0, true); sel.selectLinked(); assertEquals(s.triangleCount, sel.count)
    }
}
