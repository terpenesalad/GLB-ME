package app.glbandme.render

import android.opengl.GLES30.*
import app.glbandme.core.mesh.Mesh
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/** GPU mirror of a [Mesh] with incremental attribute uploads. */
class GpuMesh(val mesh: Mesh) {
    var vao = 0; private set
    private var vboPos = 0
    private var vboNrm = 0
    private var vboCol = 0
    private var vboUv = 0
    private var vboMask = 0
    private var ibo = 0
    private var edgeIbo = 0
    private var selIbo = 0
    var indexCount = 0; private set
    var edgeCount = 0; private set
    var selCount = 0; private set
    var hasColors = false; private set
    var hasUvs = false; private set
    var hasMask = false; private set
    var lastUsedFrame = 0L

    private var topo = -1
    private var geom = -1
    private var col = -1
    private var msk = -1
    private var uvv = -1
    private var edgeTopo = -1
    private var selVersion = -1

    private var scratch: FloatBuffer? = null

    private fun scratch(floats: Int): FloatBuffer {
        val s = scratch
        if (s != null && s.capacity() >= floats) { s.clear(); return s }
        val n = ByteBuffer.allocateDirect(maxOf(floats, 1024) * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        scratch = n
        return n
    }

    private fun upload(target: Int, id: Int, data: FloatArray, comps: Int, lo: Int, hi: Int, full: Boolean) {
        glBindBuffer(target, id)
        if (full) {
            val b = scratch(data.size)
            b.put(data).position(0)
            glBufferData(target, data.size * 4, b, GL_DYNAMIC_DRAW)
        } else {
            val off = lo * comps
            val n = (hi - lo + 1) * comps
            if (n <= 0) return
            val b = scratch(n)
            b.put(data, off, n).position(0)
            glBufferSubData(target, off * 4, n * 4, b)
        }
    }

    /** Bring GPU buffers in sync with the mesh. Must run on the GL thread under the scene lock. */
    fun sync() {
        val m = mesh
        if (vao == 0) {
            val ids = IntArray(8)
            glGenBuffers(8, ids, 0)
            vboPos = ids[0]; vboNrm = ids[1]; vboCol = ids[2]; vboUv = ids[3]; vboMask = ids[4]; ibo = ids[5]; edgeIbo = ids[6]; selIbo = ids[7]
            vao = GlUtil.genVao()
        }
        val full = topo != m.topologyVersion
        if (full) {
            glBindVertexArray(vao)
            upload(GL_ARRAY_BUFFER, vboPos, m.positions, 3, 0, 0, true)
            glVertexAttribPointer(0, 3, GL_FLOAT, false, 0, 0); glEnableVertexAttribArray(0)
            upload(GL_ARRAY_BUFFER, vboNrm, m.normals, 3, 0, 0, true)
            glVertexAttribPointer(1, 3, GL_FLOAT, false, 0, 0); glEnableVertexAttribArray(1)
            glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo)
            val ib = ByteBuffer.allocateDirect(m.indices.size * 4).order(ByteOrder.nativeOrder()).asIntBuffer()
            ib.put(m.indices).position(0)
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, m.indices.size * 4, ib, GL_STATIC_DRAW)
            indexCount = m.indices.size
            glBindVertexArray(0)
            topo = m.topologyVersion
            geom = m.geometryVersion
            col = -1; msk = -1; uvv = -1
            m.resetDirty()
        } else if (geom != m.geometryVersion) {
            val lo = m.geomDirtyLo; val hi = m.geomDirtyHi
            val all = hi < lo
            upload(GL_ARRAY_BUFFER, vboPos, m.positions, 3, if (all) 0 else lo, if (all) m.vertexCount - 1 else hi, false)
            upload(GL_ARRAY_BUFFER, vboNrm, m.normals, 3, if (all) 0 else lo, if (all) m.vertexCount - 1 else hi, false)
            geom = m.geometryVersion
            m.geomDirtyLo = Int.MAX_VALUE; m.geomDirtyHi = -1
        }
        // colors
        val c = m.colors
        if (c != null && c.size == m.vertexCount * 4) {
            if (col != m.colorVersion || !hasColors) {
                glBindVertexArray(vao)
                val lo = m.colorDirtyLo; val hi = m.colorDirtyHi
                val fullC = !hasColors || col == -1 || hi < lo
                upload(GL_ARRAY_BUFFER, vboCol, c, 4, lo, hi, fullC)
                if (!hasColors || fullC) { glVertexAttribPointer(2, 4, GL_FLOAT, false, 0, 0); glEnableVertexAttribArray(2) }
                glBindVertexArray(0)
                hasColors = true
                col = m.colorVersion
                m.colorDirtyLo = Int.MAX_VALUE; m.colorDirtyHi = -1
            }
        } else if (hasColors) {
            glBindVertexArray(vao); glDisableVertexAttribArray(2); glBindVertexArray(0)
            hasColors = false; col = -1
        }
        // uvs
        val uv = m.uvs
        if (uv != null && uv.size == m.vertexCount * 2) {
            if (uvv != m.uvVersion || !hasUvs) {
                glBindVertexArray(vao)
                upload(GL_ARRAY_BUFFER, vboUv, uv, 2, 0, 0, true)
                glVertexAttribPointer(3, 2, GL_FLOAT, false, 0, 0); glEnableVertexAttribArray(3)
                glBindVertexArray(0)
                hasUvs = true; uvv = m.uvVersion
            }
        } else if (hasUvs) {
            glBindVertexArray(vao); glDisableVertexAttribArray(3); glBindVertexArray(0)
            hasUvs = false; uvv = -1
        }
        // mask
        val mk = m.mask
        if (mk != null && mk.size == m.vertexCount) {
            if (msk != m.maskVersion || !hasMask) {
                glBindVertexArray(vao)
                val lo = m.maskDirtyLo; val hi = m.maskDirtyHi
                val fullM = !hasMask || msk == -1 || hi < lo
                upload(GL_ARRAY_BUFFER, vboMask, mk, 1, lo, hi, fullM)
                if (!hasMask || fullM) { glVertexAttribPointer(4, 1, GL_FLOAT, false, 0, 0); glEnableVertexAttribArray(4) }
                glBindVertexArray(0)
                hasMask = true; msk = m.maskVersion
                m.maskDirtyLo = Int.MAX_VALUE; m.maskDirtyHi = -1
            }
        } else if (hasMask) {
            glBindVertexArray(vao); glDisableVertexAttribArray(4); glBindVertexArray(0)
            hasMask = false; msk = -1
        }
        glBindBuffer(GL_ARRAY_BUFFER, 0)
    }

    fun syncEdges() {
        if (edgeTopo == mesh.topologyVersion) return
        val e = mesh.edges()
        glBindVertexArray(0)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, edgeIbo)
        val ib = ByteBuffer.allocateDirect(maxOf(1, e.size) * 4).order(ByteOrder.nativeOrder()).asIntBuffer()
        ib.put(e).position(0)
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, e.size * 4, ib, GL_STATIC_DRAW)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0)
        edgeCount = e.size
        edgeTopo = mesh.topologyVersion
    }

    /** Upload the index list of selected triangles (edit mode overlay). */
    fun syncSelection(version: Int, tris: IntArray?) {
        if (version == selVersion) return
        selVersion = version
        if (tris == null || tris.isEmpty()) { selCount = 0; return }
        val idx = IntArray(tris.size * 3)
        for (i in tris.indices) { val t = tris[i]; idx[i * 3] = mesh.indices[t * 3]; idx[i * 3 + 1] = mesh.indices[t * 3 + 1]; idx[i * 3 + 2] = mesh.indices[t * 3 + 2] }
        glBindVertexArray(0)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, selIbo)
        val ib = ByteBuffer.allocateDirect(idx.size * 4).order(ByteOrder.nativeOrder()).asIntBuffer()
        ib.put(idx).position(0)
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, idx.size * 4, ib, GL_DYNAMIC_DRAW)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0)
        selCount = idx.size
    }

    fun drawTriangles() {
        glBindVertexArray(vao)
        if (!hasColors) glVertexAttrib4f(2, 1f, 1f, 1f, 1f)
        if (!hasUvs) glVertexAttrib2f(3, 0f, 0f)
        if (!hasMask) glVertexAttrib1f(4, 0f)
        glDrawElements(GL_TRIANGLES, indexCount, GL_UNSIGNED_INT, 0)
        glBindVertexArray(0)
    }

    fun drawEdges() {
        syncEdges()
        glBindVertexArray(vao)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, edgeIbo)
        glDrawElements(GL_LINES, edgeCount, GL_UNSIGNED_INT, 0)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo)
        glBindVertexArray(0)
    }

    fun drawSelection() {
        if (selCount == 0) return
        glBindVertexArray(vao)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, selIbo)
        glDrawElements(GL_TRIANGLES, selCount, GL_UNSIGNED_INT, 0)
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ibo)
        glBindVertexArray(0)
    }

    fun release() {
        if (vao == 0) return
        glDeleteBuffers(8, intArrayOf(vboPos, vboNrm, vboCol, vboUv, vboMask, ibo, edgeIbo, selIbo), 0)
        GlUtil.deleteVao(vao)
        vao = 0
    }
}
