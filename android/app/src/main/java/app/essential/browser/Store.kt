package app.essential.browser

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// Данные браузера — JSON-файлы в личной папке приложения (как в ПК-версии в профиле)
class Store(private val ctx: Context) {
    private fun file(name: String) = File(ctx.filesDir, name)

    fun read(name: String): String? = try {
        file(name).takeIf { it.exists() }?.readText()
    } catch (e: Exception) {
        null
    }

    fun obj(name: String): JSONObject? = read(name)?.let { runCatching { JSONObject(it) }.getOrNull() }
    fun arr(name: String): JSONArray? = read(name)?.let { runCatching { JSONArray(it) }.getOrNull() }

    // через временный файл: если приложение убьют посреди записи, старый файл останется целым
    fun write(name: String, text: String) {
        try {
            val tmp = file("$name.tmp")
            tmp.writeText(text)
            if (!tmp.renameTo(file(name))) {
                file(name).writeText(text)
                tmp.delete()
            }
        } catch (_: Exception) {
        }
    }
}

// любое значение → JSON-текст для передачи в интерфейс
fun toJson(v: Any?): String = when (v) {
    null, Unit -> "null"
    is JSONObject, is JSONArray -> v.toString()
    is String -> JSONObject.quote(v)
    is Boolean, is Number -> v.toString()
    else -> JSONObject.quote(v.toString())
}

fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun JSONArray.strings(): List<String> = (0 until length()).mapNotNull { opt(it) as? String }
fun jsonOf(vararg pairs: Pair<String, Any?>): JSONObject = JSONObject().apply { for ((k, v) in pairs) put(k, v ?: JSONObject.NULL) }
