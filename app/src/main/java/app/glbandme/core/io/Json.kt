package app.glbandme.core.io

/**
 * Tiny dependency-free JSON reader/writer (Android's org.json isn't available in JVM unit tests).
 * Objects -> LinkedHashMap<String, Any?>, arrays -> ArrayList<Any?>, numbers -> Double.
 */
object Json {

    fun parse(text: String): Any? {
        val p = Parser(text)
        p.ws()
        val v = p.value()
        p.ws()
        if (p.i < text.length) throw JsonException("Trailing data at ${p.i}")
        return v
    }

    fun write(v: Any?, pretty: Boolean = false): String {
        val sb = StringBuilder()
        writeValue(sb, v, if (pretty) 0 else -1)
        return sb.toString()
    }

    private fun writeValue(sb: StringBuilder, v: Any?, indent: Int) {
        when (v) {
            null -> sb.append("null")
            is String -> writeString(sb, v)
            is Boolean -> sb.append(v)
            is Int, is Long, is Short, is Byte -> sb.append(v.toString())
            is Float -> writeNumber(sb, v.toDouble())
            is Double -> writeNumber(sb, v)
            is Number -> writeNumber(sb, v.toDouble())
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, value) in v) {
                    if (value == null) continue
                    if (!first) sb.append(',')
                    first = false
                    newline(sb, indent + 1)
                    writeString(sb, k.toString())
                    sb.append(if (indent >= 0) ": " else ":")
                    writeValue(sb, value, if (indent >= 0) indent + 1 else -1)
                }
                if (!first) newline(sb, indent)
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (value in v) {
                    if (!first) sb.append(',')
                    first = false
                    writeValue(sb, value, if (indent >= 0) indent + 1 else -1)
                }
                sb.append(']')
            }
            is FloatArray -> writeValue(sb, v.toList(), indent)
            is IntArray -> writeValue(sb, v.toList(), indent)
            is DoubleArray -> writeValue(sb, v.toList(), indent)
            is Array<*> -> writeValue(sb, v.toList(), indent)
            else -> writeString(sb, v.toString())
        }
    }

    private fun newline(sb: StringBuilder, indent: Int) {
        if (indent < 0) return
        sb.append('\n')
        repeat(indent) { sb.append("  ") }
    }

    private fun writeNumber(sb: StringBuilder, d: Double) {
        if (d.isNaN() || d.isInfinite()) { sb.append("0"); return }
        if (d == Math.rint(d) && kotlin.math.abs(d) < 1e15) sb.append(d.toLong().toString())
        else {
            // shortest float-ish representation
            val f = d.toFloat()
            if (f.toDouble() == d) sb.append(f.toString()) else sb.append(d.toString())
        }
    }

    private fun writeString(sb: StringBuilder, s: String) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else -> if (c < ' ') sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
            }
        }
        sb.append('"')
    }

    private class Parser(val s: String) {
        var i = 0

        fun ws() { while (i < s.length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++ }

        fun value(): Any? {
            if (i >= s.length) throw JsonException("Unexpected end")
            return when (val c = s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> lit("true", true)
                'f' -> lit("false", false)
                'n' -> lit("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else throw JsonException("Unexpected '$c' at $i")
            }
        }

        private fun lit(word: String, v: Any?): Any? {
            if (!s.startsWith(word, i)) throw JsonException("Bad literal at $i")
            i += word.length
            return v
        }

        private fun obj(): Map<String, Any?> {
            val m = LinkedHashMap<String, Any?>()
            i++; ws()
            if (s[i] == '}') { i++; return m }
            while (true) {
                ws()
                if (s[i] != '"') throw JsonException("Expected key at $i")
                val k = str()
                ws()
                if (s[i] != ':') throw JsonException("Expected ':' at $i")
                i++; ws()
                m[k] = value()
                ws()
                when (s[i]) {
                    ',' -> i++
                    '}' -> { i++; return m }
                    else -> throw JsonException("Expected ',' or '}' at $i")
                }
            }
        }

        private fun arr(): List<Any?> {
            val l = ArrayList<Any?>()
            i++; ws()
            if (s[i] == ']') { i++; return l }
            while (true) {
                ws()
                l.add(value())
                ws()
                when (s[i]) {
                    ',' -> i++
                    ']' -> { i++; return l }
                    else -> throw JsonException("Expected ',' or ']' at $i")
                }
            }
        }

        private fun str(): String {
            i++
            val sb = StringBuilder()
            while (true) {
                if (i >= s.length) throw JsonException("Unterminated string")
                val c = s[i++]
                when (c) {
                    '"' -> return sb.toString()
                    '\\' -> {
                        when (val e = s[i++]) {
                            '"' -> sb.append('"'); '\\' -> sb.append('\\'); '/' -> sb.append('/')
                            'b' -> sb.append('\b'); 'f' -> sb.append('\u000C'); 'n' -> sb.append('\n')
                            'r' -> sb.append('\r'); 't' -> sb.append('\t')
                            'u' -> { sb.append(s.substring(i, i + 4).toInt(16).toChar()); i += 4 }
                            else -> throw JsonException("Bad escape \\$e")
                        }
                    }
                    else -> sb.append(c)
                }
            }
        }

        private fun num(): Double {
            val start = i
            if (s[i] == '-') i++
            while (i < s.length && (s[i].isDigit() || s[i] == '.' || s[i] == 'e' || s[i] == 'E' || s[i] == '+' || s[i] == '-')) i++
            return s.substring(start, i).toDouble()
        }
    }
}

class JsonException(msg: String) : Exception(msg)

// ---- convenient typed accessors -----------------------------------------------------------
@Suppress("UNCHECKED_CAST")
fun Any?.obj(): Map<String, Any?>? = this as? Map<String, Any?>
@Suppress("UNCHECKED_CAST")
fun Any?.arr(): List<Any?>? = this as? List<Any?>
fun Map<String, Any?>.o(k: String): Map<String, Any?>? = this[k].obj()
fun Map<String, Any?>.a(k: String): List<Any?>? = this[k].arr()
fun Map<String, Any?>.s(k: String): String? = this[k] as? String
fun Map<String, Any?>.d(k: String, def: Double = 0.0): Double = (this[k] as? Number)?.toDouble() ?: def
fun Map<String, Any?>.f(k: String, def: Float = 0f): Float = (this[k] as? Number)?.toFloat() ?: def
fun Map<String, Any?>.i(k: String, def: Int = 0): Int = (this[k] as? Number)?.toInt() ?: def
fun Map<String, Any?>.iOrNull(k: String): Int? = (this[k] as? Number)?.toInt()
fun Map<String, Any?>.b(k: String, def: Boolean = false): Boolean = (this[k] as? Boolean) ?: def
fun Map<String, Any?>.floats(k: String): FloatArray? = this.a(k)?.map { (it as Number).toFloat() }?.toFloatArray()
