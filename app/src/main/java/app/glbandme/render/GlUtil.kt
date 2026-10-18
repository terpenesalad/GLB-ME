package app.glbandme.render

import android.opengl.GLES30.*
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.nio.ShortBuffer

object GlUtil {
    private const val TAG = "GLB&ME-GL"

    fun compile(type: Int, src: String): Int {
        val s = glCreateShader(type)
        glShaderSource(s, src)
        glCompileShader(s)
        val ok = IntArray(1)
        glGetShaderiv(s, GL_COMPILE_STATUS, ok, 0)
        if (ok[0] == 0) {
            val log = glGetShaderInfoLog(s)
            glDeleteShader(s)
            throw RuntimeException("Shader compile failed: $log\n$src")
        }
        return s
    }

    fun program(vs: String, fs: String): Int {
        val v = compile(GL_VERTEX_SHADER, vs)
        val f = compile(GL_FRAGMENT_SHADER, fs)
        val p = glCreateProgram()
        glAttachShader(p, v); glAttachShader(p, f)
        glLinkProgram(p)
        val ok = IntArray(1)
        glGetProgramiv(p, GL_LINK_STATUS, ok, 0)
        glDeleteShader(v); glDeleteShader(f)
        if (ok[0] == 0) {
            val log = glGetProgramInfoLog(p)
            glDeleteProgram(p)
            throw RuntimeException("Program link failed: $log")
        }
        return p
    }

    fun check(where: String) {
        var e = glGetError()
        while (e != GL_NO_ERROR) {
            Log.w(TAG, "GL error 0x${Integer.toHexString(e)} at $where")
            e = glGetError()
        }
    }

    fun floatBuffer(a: FloatArray, offset: Int = 0, count: Int = a.size - offset): FloatBuffer {
        val b = ByteBuffer.allocateDirect(count * 4).order(ByteOrder.nativeOrder()).asFloatBuffer()
        b.put(a, offset, count).position(0)
        return b
    }

    fun intBuffer(a: IntArray): IntBuffer {
        val b = ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder()).asIntBuffer()
        b.put(a).position(0)
        return b
    }

    fun shortBuffer(a: ShortArray): ShortBuffer {
        val b = ByteBuffer.allocateDirect(a.size * 2).order(ByteOrder.nativeOrder()).asShortBuffer()
        b.put(a).position(0)
        return b
    }

    fun genBuffer(): Int { val a = IntArray(1); glGenBuffers(1, a, 0); return a[0] }
    fun genTexture(): Int { val a = IntArray(1); glGenTextures(1, a, 0); return a[0] }
    fun genVao(): Int { val a = IntArray(1); glGenVertexArrays(1, a, 0); return a[0] }
    fun genFramebuffer(): Int { val a = IntArray(1); glGenFramebuffers(1, a, 0); return a[0] }
    fun genRenderbuffer(): Int { val a = IntArray(1); glGenRenderbuffers(1, a, 0); return a[0] }
    fun deleteBuffer(id: Int) { if (id != 0) glDeleteBuffers(1, intArrayOf(id), 0) }
    fun deleteTexture(id: Int) { if (id != 0) glDeleteTextures(1, intArrayOf(id), 0) }
    fun deleteVao(id: Int) { if (id != 0) glDeleteVertexArrays(1, intArrayOf(id), 0) }

    /** Simple uniform location cache per program. */
    class Program(vs: String, fs: String) {
        val id = program(vs, fs)
        private val locs = HashMap<String, Int>()
        fun u(name: String): Int = locs.getOrPut(name) { glGetUniformLocation(id, name) }
        fun use() = glUseProgram(id)
        fun set1i(n: String, v: Int) { val l = u(n); if (l >= 0) glUniform1i(l, v) }
        fun set1f(n: String, v: Float) { val l = u(n); if (l >= 0) glUniform1f(l, v) }
        fun set2f(n: String, a: Float, b: Float) { val l = u(n); if (l >= 0) glUniform2f(l, a, b) }
        fun set3f(n: String, a: Float, b: Float, c: Float) { val l = u(n); if (l >= 0) glUniform3f(l, a, b, c) }
        fun set4f(n: String, a: Float, b: Float, c: Float, d: Float) { val l = u(n); if (l >= 0) glUniform4f(l, a, b, c, d) }
        fun set3fv(n: String, v: FloatArray, count: Int = v.size / 3) { val l = u(n); if (l >= 0) glUniform3fv(l, count, v, 0) }
        fun set4fv(n: String, v: FloatArray, count: Int = v.size / 4) { val l = u(n); if (l >= 0) glUniform4fv(l, count, v, 0) }
        fun setMat4(n: String, m: FloatArray) { val l = u(n); if (l >= 0) glUniformMatrix4fv(l, 1, false, m, 0) }
        fun setMat3(n: String, m: FloatArray) { val l = u(n); if (l >= 0) glUniformMatrix3fv(l, 1, false, m, 0) }
        fun release() = glDeleteProgram(id)
    }
}
