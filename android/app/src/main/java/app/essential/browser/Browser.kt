package app.essential.browser

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.net.Uri
import android.net.http.SslError
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.util.Base64
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.ProfileStore
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

const val ASSETS = "file:///android_asset/ui/"
const val NEWTAB_URL = ASSETS + "newtab.html"
const val WARN_URL = ASSETS + "warning.html"
private const val PRIVATE_PROFILE = "essential-private"
private const val MAX_LIVE_VIEWS = 6 // остальные вкладки «спят»: адрес и заголовок помним, страницу выгружаем

val ENGINES = linkedMapOf(
    "google" to ("Google" to "https://www.google.com/search?q="),
    "yandex" to ("Яндекс" to "https://ya.ru/search/?text="),
    "duckduckgo" to ("DuckDuckGo" to "https://duckduckgo.com/?q="),
    "bing" to ("Bing" to "https://www.bing.com/search?q="),
)
val ICONS = listOf("🏠", "💼", "🎮", "🎵", "📚", "🌙", "🔥", "🌊", "🌿", "🌸", "⚡", "🚀", "🎨", "🧪", "💻", "📷", "🍿", "🛒", "✈️", "🐱", "❤️", "⭐", "🧠", "💬")
val COLORS = listOf("#2f7bff", "#7c5cff", "#ff6a2b", "#1fa2ff", "#2ecc71", "#ff5fa2", "#f5c400", "#00c2b8", "#e84545")
val THEME_PRESETS = JSONArray(
    """[["#2f7bff","#16c2ff"],["#ff6a2b","#ffb02e"],["#1fa2ff","#12d8fa","#a6ffcb"],["#ff5fa2","#7c5cff"],
    ["#2ecc71","#00c2b8"],["#f5c400","#ff6a2b","#e84545"],["#3a1c71","#d76d77","#ffaf7b"],["#0f2027","#2c5364"],
    ["#ee9ca7","#ffdde1"],["#43cea2","#185a9d"],["#c471f5","#fa71cd"],["#8e9eab","#eef2f3"]]"""
)

// как DEFAULT_SETTINGS в main.js — те же ключи там, где функция есть на телефоне
private const val DEFAULT_SETTINGS = """{
  "searchEngine": "google", "rememberSearches": true, "restoreSession": true, "doNotTrack": false,
  "permissions": { "media": "ask", "geolocation": "ask" },
  "forceDarkSites": false, "textZoom": 100, "minFontSize": 0,
  "onboarded": false, "newTabStyle": "page", "autoUpdate": true,
  "httpsWarning": true, "httpAllowed": [],
  "clock": { "style": "thin", "color": "white", "seconds": false, "h12": false, "date": true },
  "alertsCountry": "", "alertsRegion": "", "alertsRegionName": "", "alertsSound": true, "alertsSource": ""
}"""
val CLOCK_OPTIONS = mapOf(
    "style" to listOf("thin", "bold", "stacked", "outline", "mono", "analog", "hidden"),
    "color" to listOf("white", "accent", "gradient"),
)

class Space(val id: Int, var name: String, var icon: String, var theme: JSONObject) {
    val tabIds = mutableListOf<Int>()
    var activeTab: Int? = null
}

class Tab(val id: Int, var spaceId: Int, var url: String, var title: String, var favicon: String?, val isPrivate: Boolean, val openerId: Int?) {
    var view: WebView? = null
    var progress = 100
    var loading = false
    var thumb: String? = null
    var lastUsed = System.currentTimeMillis()
    var desktop = false
    var requested = "" // главный адрес, который сейчас открывается — для страницы-предупреждения о сертификате
}

class Browser(val act: MainActivity) {
    val store = Store(act)
    private val main = Handler(Looper.getMainLooper())
    val settings: JSONObject = loadSettings()
    val spaces = mutableListOf<Space>()
    val tabs = linkedMapOf<Int, Tab>()
    var activeSpace = 0
    private var nextId = 1
    private val closed = ArrayDeque<Pair<String, Int>>()
    private var shown: WebView? = null
    var history = mutableListOf<JSONObject>() // { url, title, ts }
    var searches = mutableListOf<JSONObject>() // { q, ts }
    var essentials = mutableListOf<JSONObject>() // { url, title }
    val favicons = LinkedHashMap<String, String>() // host → data:image
    private val certAllowed = mutableSetOf<String>() // «всё равно перейти» с битым сертификатом — до закрытия браузера
    private val sitePerms = mutableMapOf<String, Boolean>() // origin|permission → решение на эту сессию
    val downloads = Downloads(act) { pushState() }
    val updater = Updater(act) { pushState() }
    val alerts = Alerts(act, this)
    private var findActive = false

    private val defaultUA: String by lazy {
        // «; wv» и «Version/4.0» выдают встроенный WebView — без них сайты видят обычный Chrome для Android
        WebSettings.getDefaultUserAgent(act).replace("; wv", "").replace(Regex("Version/[\\d.]+ "), "")
    }
    private val desktopUA: String by lazy {
        val chrome = Regex("Chrome/([\\d.]+)").find(defaultUA)?.groupValues?.get(1) ?: "130.0.0.0"
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$chrome Safari/537.36"
    }

    // ---------- запуск ----------

    fun start(intent: Intent?) {
        history = store.arr("history.json")?.objects()?.toMutableList() ?: mutableListOf()
        searches = store.arr("searches.json")?.objects()?.toMutableList() ?: mutableListOf()
        essentials = store.arr("essentials.json")?.objects()?.toMutableList() ?: mutableListOf(
            jsonOf("title" to "YouTube", "url" to "https://www.youtube.com/"),
            jsonOf("title" to "GitHub", "url" to "https://github.com/"),
            jsonOf("title" to "ВКонтакте", "url" to "https://vk.com/"),
            jsonOf("title" to "Википедия", "url" to "https://ru.wikipedia.org/"),
        )
        store.obj("favicons.json")?.let { o -> o.keys().forEach { favicons[it] = o.getString(it) } }
        // приватный профиль прошлого запуска — стираем целиком
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) runCatching { ProfileStore.getInstance().deleteProfile(PRIVATE_PROFILE) }
        restoreSession()
        openIntent(intent)
        alerts.restart()
        downloads.restore()
        main.postDelayed({ if (settings.optBoolean("autoUpdate", true)) updater.check() }, 15000)
        main.postDelayed(object : Runnable {
            override fun run() {
                if (settings.optBoolean("autoUpdate", true)) updater.check()
                main.postDelayed(this, 4 * 3600 * 1000L)
            }
        }, 4 * 3600 * 1000L)
    }

    private fun loadSettings(): JSONObject {
        val s = JSONObject(DEFAULT_SETTINGS)
        val saved = Store(act).obj("settings.json") ?: return s
        for (k in saved.keys()) {
            if (!s.has(k)) continue
            val def = s.get(k)
            if (def is JSONObject && saved.opt(k) is JSONObject) {
                val merged = JSONObject(def.toString())
                val v = saved.getJSONObject(k)
                for (kk in v.keys()) merged.put(kk, v.get(kk))
                s.put(k, merged)
            } else s.put(k, saved.get(k))
        }
        return s
    }

    fun saveSettings() = store.write("settings.json", settings.toString())

    // ---------- пространства и вкладки ----------

    fun space(id: Int = activeSpace) = spaces.firstOrNull { it.id == id } ?: spaces.first()
    fun activeTab(): Tab? = space().activeTab?.let { tabs[it] }

    fun defaultTheme(color: String = COLORS[0]) = JSONObject().put("colors", JSONArray().put(color).put("#16c2ff")).put("strength", 55).put("grain", 0).put("mode", "dark")

    fun createSpace(name: String? = null, icon: String? = null, theme: JSONObject? = null): Space {
        val color = COLORS[spaces.size % COLORS.size]
        val sp = Space(nextId++, name ?: if (spaces.isEmpty()) "Дом" else "Пространство ${spaces.size + 1}", icon ?: ICONS[spaces.size % ICONS.size],
            sanitizeTheme(theme) ?: if (spaces.isEmpty()) defaultTheme() else JSONObject().put("colors", JSONArray().put(color)).put("strength", 55).put("grain", 0).put("mode", "dark"))
        spaces.add(sp)
        return sp
    }

    // тема приходит из интерфейса — оставляем только понятные поля (как sanitizeTheme в main.js)
    fun sanitizeTheme(t: JSONObject?): JSONObject? {
        if (t == null) return null
        val hex = Regex("^#[0-9a-fA-F]{6}$")
        val colors = JSONArray()
        t.optJSONArray("colors")?.strings()?.filter { hex.matches(it) }?.take(4)?.forEach { colors.put(it) }
        if (colors.length() == 0) colors.put(COLORS[0])
        return JSONObject().put("colors", colors)
            .put("strength", t.optInt("strength", 55).coerceIn(0, 100))
            .put("grain", t.optInt("grain", 0).coerceIn(0, 100))
            .put("mode", if (t.optString("mode") == "light") "light" else "dark")
    }

    fun createTab(url: String = NEWTAB_URL, activate: Boolean = true, spaceId: Int = activeSpace, private: Boolean = false, opener: Int? = null, restore: JSONObject? = null): Tab {
        val tab = Tab(nextId++, spaceId, url, restore?.optString("title") ?: "", restore?.optString("favicon")?.takeIf { it.isNotEmpty() }, private, opener)
        tabs[tab.id] = tab
        val sp = space(spaceId)
        val idx = sp.tabIds.indexOf(sp.activeTab ?: -1)
        if (restore != null || idx == -1) sp.tabIds.add(tab.id) else sp.tabIds.add(idx + 1, tab.id)
        if (activate) switchTab(tab.id)
        else pushState()
        return tab
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun ensureView(tab: Tab, load: Boolean = true): WebView {
        tab.view?.let { return it }
        val wv = WebView(act)
        if (tab.isPrivate && WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            // приватные вкладки — в отдельном профиле: свои cookies и кэш, стираются при следующем запуске
            runCatching {
                ProfileStore.getInstance().getOrCreateProfile(PRIVATE_PROFILE)
                WebViewCompat.setProfile(wv, PRIVATE_PROFILE)
            }
        }
        wv.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false // всплывающие окна — только по нажатию пользователя
            mediaPlaybackRequiresUserGesture = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            setGeolocationEnabled(true)
            userAgentString = if (tab.desktop) desktopUA else defaultUA
            textZoom = settings.optInt("textZoom", 100)
            minimumFontSize = settings.optInt("minFontSize", 0).coerceAtLeast(1)
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(wv.settings, settings.optBoolean("forceDarkSites"))
        }
        // без заголовка X-Requested-With сайты (и вход в Google) не видят, что это встроенный WebView
        if (WebViewFeature.isFeatureSupported(WebViewFeature.REQUESTED_WITH_HEADER_ALLOW_LIST)) {
            WebSettingsCompat.setRequestedWithHeaderOriginAllowList(wv.settings, emptySet())
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(wv, true)
        wv.setBackgroundColor(Color.WHITE)
        wv.webViewClient = PageClient(tab)
        wv.webChromeClient = ChromeClient(tab)
        wv.setDownloadListener { url, ua, disposition, mime, length ->
            downloads.start(url, ua, disposition, mime, length, CookieManager.getInstance().getCookie(url))
        }
        wv.setFindListener { active, total, done -> if (done && activeTab() === tab) act.emit("find", jsonOf("active" to if (total == 0) 0 else active + 1, "total" to total)) }
        wv.setOnLongClickListener { longPress(wv, tab) }
        tab.view = wv
        if (load) loadInto(tab, tab.url.ifEmpty { NEWTAB_URL })
        return wv
    }

    // все наши переходы идут через эту функцию: предупреждение о сайтах без HTTPS и «Не отслеживать»
    fun loadInto(tab: Tab, url: String) {
        val wv = tab.view ?: run { tab.url = url; ensureView(tab); return }
        if (needsHttpWarning(url)) return wv.loadUrl(warnUrl("http", url))
        tab.requested = url
        if (settings.optBoolean("doNotTrack") && url.startsWith("http")) wv.loadUrl(url, mapOf("DNT" to "1", "Sec-GPC" to "1"))
        else wv.loadUrl(url)
    }

    fun switchTab(id: Int) {
        val tab = tabs[id] ?: return
        if (findActive) findClose()
        activeSpace = tab.spaceId
        space().activeTab = id
        tab.lastUsed = System.currentTimeMillis()
        showActive()
        pushState()
    }

    fun showActive() {
        val tab = activeTab()
        val view = tab?.let { ensureView(it) }
        if (shown !== view) {
            shown?.let { old ->
                tabs.values.firstOrNull { it.view === old }?.let { it.thumb = snapshot(old) }
                old.onPause()
                act.pages.removeView(old)
            }
            view?.let {
                (it.parent as? ViewGroup)?.removeView(it)
                act.pages.addView(it, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
                it.onResume()
            }
            shown = view
            refreshNewtab(view)
            act.applyTheme(space().theme)
        }
        trimViews()
    }

    // маленький снимок страницы для списка вкладок
    private fun snapshot(v: WebView): String? = runCatching {
        if (v.width == 0 || v.height == 0) return null
        val scale = 0.35f
        val h = (v.width * 1.25f).toInt().coerceAtMost(v.height)
        val bmp = Bitmap.createBitmap((v.width * scale).toInt(), (h * scale).toInt(), Bitmap.Config.RGB_565)
        Canvas(bmp).apply { scale(scale, scale) }.also { v.draw(it) }
        "data:image/jpeg;base64," + Base64.encodeToString(ByteArrayOutputStream().also { bmp.compress(Bitmap.CompressFormat.JPEG, 60, it) }.toByteArray(), Base64.NO_WRAP)
    }.getOrNull()

    // неактивные вкладки «засыпают», чтобы не съедать память
    private fun trimViews() {
        val live = tabs.values.filter { it.view != null && it.view !== shown }.sortedByDescending { it.lastUsed }
        for (t in live.drop(MAX_LIVE_VIEWS)) {
            t.url = t.view?.url ?: t.url
            t.title = t.view?.title ?: t.title
            destroyView(t)
        }
    }

    private fun destroyView(t: Tab) {
        val v = t.view ?: return
        t.view = null
        if (shown === v) shown = null
        act.pages.removeView(v)
        v.stopLoading()
        v.destroy()
    }

    fun closeTab(id: Int) {
        val tab = tabs[id] ?: return
        val sp = space(tab.spaceId)
        val url = tab.view?.url ?: tab.url
        if (!tab.isPrivate && displayUrl(url).isNotEmpty()) closed.addLast(url to tab.spaceId)
        val idx = sp.tabIds.indexOf(id)
        sp.tabIds.remove(id)
        destroyView(tab)
        tabs.remove(id)
        if (sp.activeTab == id) {
            // как в Chrome: закрыли вкладку, открытую из другой, — возвращаемся в ту
            val opener = tab.openerId?.takeIf { sp.tabIds.contains(it) }
            sp.activeTab = opener ?: sp.tabIds.getOrNull(minOf(idx, sp.tabIds.size - 1))
        }
        if (tab.isPrivate && tabs.values.none { it.isPrivate } && WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            main.postDelayed({ runCatching { ProfileStore.getInstance().deleteProfile(PRIVATE_PROFILE) } }, 500)
        }
        if (sp.id != activeSpace) return pushState()
        if (sp.tabIds.isEmpty()) createTab()
        else showActive()
        pushState()
    }

    fun reopenClosed() {
        val (url, spaceId) = closed.removeLastOrNull() ?: return
        createTab(url, spaceId = if (spaces.any { it.id == spaceId }) spaceId else activeSpace)
    }

    fun closeAll(private: Boolean) {
        val ids = space().tabIds.filter { tabs[it]?.isPrivate == private }
        for (id in ids) closeTab(id)
    }

    fun switchSpace(id: Int) {
        val sp = spaces.firstOrNull { it.id == id } ?: return
        activeSpace = sp.id
        if (sp.tabIds.isEmpty()) createTab(spaceId = sp.id) else switchTab(sp.activeTab ?: sp.tabIds.first())
        act.applyTheme(sp.theme)
        pushState()
    }

    fun deleteSpace(id: Int) {
        if (spaces.size < 2) return
        val sp = spaces.firstOrNull { it.id == id } ?: return
        for (t in sp.tabIds.toList()) { destroyView(tabs[t] ?: continue); tabs.remove(t) }
        spaces.remove(sp)
        switchSpace(spaces.first().id)
    }

    // ---------- переходы ----------

    // Текст из адресной строки: адрес — открываем, иначе ищем
    fun go(text: String, newTab: Boolean, private: Boolean = false) {
        val raw = text.trim()
        if (raw.isEmpty()) return
        val url = parseUrl(raw) ?: searchUrl() + Uri.encode(raw)
        if (parseUrl(raw) == null) rememberSearch(raw)
        val cur = activeTab()
        // пустая новая вкладка — открываем в ней же, а не плодим ещё одну
        if (newTab && !(cur != null && displayUrl(cur.view?.url ?: cur.url).isEmpty() && cur.isPrivate == private)) createTab(url, private = private)
        else cur?.let { loadInto(it, url) } ?: createTab(url)
    }

    fun searchUrl() = (ENGINES[settings.optString("searchEngine")] ?: ENGINES["google"]!!).second

    fun handleBack(): Boolean {
        val tab = activeTab() ?: return false
        val v = tab.view ?: return false
        if (v.canGoBack()) { v.goBack(); return true }
        if (tab.openerId != null && tabs.containsKey(tab.openerId)) { closeTab(tab.id); return true }
        return false
    }

    fun openIntent(intent: Intent?) {
        val url = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_WEB_SEARCH -> intent.getStringExtra("query")?.let { parseUrl(it) ?: searchUrl() + Uri.encode(it) }
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)?.let { t ->
                Regex("https?://\\S+").find(t)?.value ?: (searchUrl() + Uri.encode(t))
            }
            else -> null
        } ?: return
        if (url.startsWith("http://") || url.startsWith("https://")) createTab(url)
    }

    // ---------- сайты без сертификата (как в ПК-версии) ----------

    fun warnUrl(kind: String, target: String, error: String = "") =
        "$WARN_URL?kind=$kind&url=${Uri.encode(target)}&error=${Uri.encode(error)}"

    private fun hostOf(url: String) = runCatching { Uri.parse(url).host ?: "" }.getOrDefault("")

    private fun isLocalHost(host: String) = !host.contains('.') ||
        Regex("\\.(local|lan|home|internal|localhost|test|arpa)$", RegexOption.IGNORE_CASE).containsMatchIn(host) ||
        Regex("^(127\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2\\d|3[01])\\.)").containsMatchIn(host) || host == "localhost"

    fun needsHttpWarning(url: String): Boolean {
        if (!settings.optBoolean("httpsWarning", true) || !url.startsWith("http:")) return false
        val host = hostOf(url)
        return host.isNotEmpty() && !isLocalHost(host) && !settings.optJSONArray("httpAllowed")!!.strings().contains(host)
    }

    fun displayUrl(url: String?): String {
        if (url.isNullOrEmpty() || url == NEWTAB_URL || url == "about:blank") return ""
        // на страницах предупреждения и ошибки в адресной строке — сайт, куда шли
        if (url.startsWith(WARN_URL) || url.startsWith(ASSETS + "error.html")) return Uri.parse(url).getQueryParameter("url") ?: ""
        return url
    }

    // страница-предупреждение и новая вкладка просят браузер переходом на essential-action:… — как на ПК
    private fun pageAction(view: WebView, tab: Tab, url: String) {
        val u = Uri.parse(url.replaceFirst("essential-action:", "essential-action://x/"))
        val action = u.path?.trim('/') ?: return
        val cur = view.url ?: ""
        if (cur.startsWith(WARN_URL)) {
            val target = u.getQueryParameter("url") ?: ""
            when (action) {
                "back" -> if (view.canGoBack()) view.goBack() else view.loadUrl(NEWTAB_URL)
                "proceed" -> if (target.startsWith("https://")) { certAllowed.add(hostOf(target)); loadInto(tab, target) }
                else if (target.startsWith("http://")) {
                    val list = settings.optJSONArray("httpAllowed")!!.strings().filter { it != hostOf(target) } + hostOf(target)
                    settings.put("httpAllowed", JSONArray(list.takeLast(500))); saveSettings()
                    loadInto(tab, target)
                }
                "https" -> if (target.startsWith("http://")) loadInto(tab, target.replaceFirst("http://", "https://"))
            }
            return
        }
        if (cur != NEWTAB_URL) return
        when (action) {
            "clock" -> {
                val c = settings.getJSONObject("clock")
                for ((k, opts) in CLOCK_OPTIONS) u.getQueryParameter(k)?.takeIf { it in opts }?.let { c.put(k, it) }
                for (k in listOf("seconds", "h12", "date")) u.getQueryParameter(k)?.let { c.put(k, it == "1") }
                saveSettings(); refreshNewtab(view)
            }
            "add" -> u.getQueryParameter("url")?.takeIf { it.startsWith("http") }?.let { addEssential(it, u.getQueryParameter("title") ?: it) }
            "remove" -> u.getQueryParameter("url")?.let { removeEssential(it) }
        }
    }

    // новая вкладка — обычная страница без доступа к браузеру, поэтому тему, поиск, закреплённые и часы передаём сами
    fun refreshNewtab(view: WebView?) {
        if (view == null || view.url != NEWTAB_URL) return
        val (name, url) = ENGINES[settings.optString("searchEngine")] ?: ENGINES["google"]!!
        val data = jsonOf("theme" to space().theme, "engine" to jsonOf("name" to name, "url" to url), "essentials" to withIcons(essentials.take(12)), "clock" to settings.getJSONObject("clock"))
        view.evaluateJavascript("window.essentialInit && window.essentialInit($data)", null)
    }

    fun refreshAllNewtabs() = tabs.values.forEach { refreshNewtab(it.view) }

    // ---------- закреплённые ----------

    fun addEssential(url: String, title: String): Boolean {
        if (displayUrl(url).isEmpty() || essentials.any { it.optString("url") == url }) return false
        essentials.add(jsonOf("url" to url, "title" to title.ifEmpty { url }))
        store.write("essentials.json", JSONArray(essentials).toString())
        refreshAllNewtabs(); pushState()
        return true
    }

    fun removeEssential(url: String) {
        essentials.removeAll { it.optString("url") == url }
        store.write("essentials.json", JSONArray(essentials).toString())
        refreshAllNewtabs(); pushState()
    }

    fun togglePin() {
        val t = activeTab() ?: return
        val url = displayUrl(t.view?.url ?: t.url)
        if (url.isEmpty()) return
        if (essentials.any { it.optString("url") == url }) { removeEssential(url); toast("Сайт откреплён") }
        else if (addEssential(url, t.view?.title ?: t.title)) toast("Сайт закреплён")
    }

    // ---------- иконки, история, запросы ----------

    private fun rememberFavicon(url: String, icon: Bitmap) {
        val host = hostOf(url).ifEmpty { return }
        val data = "data:image/png;base64," + Base64.encodeToString(ByteArrayOutputStream().also {
            Bitmap.createScaledBitmap(icon, 64, 64, true).compress(Bitmap.CompressFormat.PNG, 100, it)
        }.toByteArray(), Base64.NO_WRAP)
        favicons.remove(host)
        favicons[host] = data
        while (favicons.size > 400) favicons.remove(favicons.keys.first())
        saveLater("favicons") { store.write("favicons.json", JSONObject(favicons as Map<*, *>).toString()) }
    }

    fun iconOf(url: String): String? = favicons[hostOf(url)]
    fun withIcons(list: List<JSONObject>) = JSONArray(list.map { JSONObject(it.toString()).put("icon", it.optString("icon").ifEmpty { iconOf(it.optString("url")) ?: "" }) })

    private fun addHistory(url: String, title: String) {
        if (displayUrl(url).isEmpty() || !url.startsWith("http")) return
        val old = history.indexOfFirst { it.optString("url") == url }
        val entry = jsonOf("url" to url, "title" to title.ifEmpty { if (old >= 0) history[old].optString("title") else "" }, "ts" to System.currentTimeMillis())
        if (old >= 0) history.removeAt(old)
        history.add(0, entry)
        if (history.size > 3000) history.subList(3000, history.size).clear()
        saveLater("history") { store.write("history.json", JSONArray(history).toString()) }
    }

    // запрос из любого поиска: адресная строка, новая вкладка или сам поисковик
    private fun searchFromUrl(url: String): String? = runCatching {
        val u = Uri.parse(url)
        val host = u.host ?: return null
        when {
            Regex("(^|\\.)google\\.").containsMatchIn(host) && u.path == "/search" -> u.getQueryParameter("q")
            Regex("(^|\\.)(ya\\.ru|yandex\\.)").containsMatchIn(host) && u.path?.startsWith("/search") == true -> u.getQueryParameter("text")
            host.endsWith("duckduckgo.com") -> u.getQueryParameter("q")
            host.endsWith("bing.com") && u.path == "/search" -> u.getQueryParameter("q")
            else -> null
        }
    }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() }

    fun rememberSearch(q: String) {
        if (!settings.optBoolean("rememberSearches", true)) return
        searches.removeAll { it.optString("q").equals(q, ignoreCase = true) }
        searches.add(0, jsonOf("q" to q, "ts" to System.currentTimeMillis()))
        if (searches.size > 300) searches.subList(300, searches.size).clear()
        saveLater("searches") { store.write("searches.json", JSONArray(searches).toString()) }
    }

    fun forgetSearch(q: String) {
        searches.removeAll { it.optString("q") == q }
        store.write("searches.json", JSONArray(searches).toString())
    }

    // подсказки адресной строки — как suggest() в main.js
    fun suggest(input: String): JSONArray {
        val raw = input.trim()
        val q = raw.lowercase()
        val out = mutableListOf<JSONObject>()
        fun query(s: JSONObject) = jsonOf("type" to "query", "title" to s.optString("q"), "url" to searchUrl() + Uri.encode(s.optString("q")))
        if (q.isEmpty()) {
            searches.take(5).forEach { out.add(query(it)) }
            history.take(4).forEach { out.add(jsonOf("type" to "history", "title" to it.optString("title").ifEmpty { it.optString("url") }, "url" to it.optString("url"))) }
            return withIcons(out)
        }
        val direct = parseUrl(raw)
        out.add(if (direct != null) jsonOf("type" to "url", "title" to direct, "url" to direct)
        else jsonOf("type" to "search", "title" to raw, "url" to searchUrl() + Uri.encode(raw), "engine" to (ENGINES[settings.optString("searchEngine")] ?: ENGINES["google"]!!).first))
        searches.filter { val s = it.optString("q").lowercase(); s != q && s.contains(q) }
            .sortedByDescending { it.optString("q").lowercase().startsWith(q) }.take(4).forEach { out.add(query(it)) }
        val match = { t: String, u: String -> t.lowercase().contains(q) || u.lowercase().contains(q) }
        val seen = mutableSetOf<String>()
        for (sp in spaces) for (id in sp.tabIds) {
            val t = tabs[id] ?: continue
            val u = displayUrl(t.view?.url ?: t.url)
            if (u.isNotEmpty() && match(t.view?.title ?: t.title, u) && out.size < 8) {
                out.add(jsonOf("type" to "tab", "title" to (t.view?.title ?: t.title), "url" to u, "tabId" to id, "ws" to sp.icon)); seen.add(u)
            }
        }
        for (e in essentials) if (e.optString("url") !in seen && match(e.optString("title"), e.optString("url"))) {
            out.add(jsonOf("type" to "essential", "title" to e.optString("title"), "url" to e.optString("url"))); seen.add(e.optString("url"))
        }
        for (h in history) {
            if (out.size >= 13) break
            val u = h.optString("url")
            if (u !in seen && match(h.optString("title"), u)) { out.add(jsonOf("type" to "history", "title" to h.optString("title").ifEmpty { u }, "url" to u)); seen.add(u) }
        }
        return withIcons(out)
    }

    // ---------- поиск на странице, меню, общий доступ ----------

    fun find(q: String, forward: Boolean?) {
        val v = activeTab()?.view ?: return
        findActive = true
        if (forward == null) v.findAllAsync(q) else v.findNext(forward)
    }

    fun findClose() {
        findActive = false
        activeTab()?.view?.clearMatches()
    }

    fun share() {
        val t = activeTab() ?: return
        val url = displayUrl(t.view?.url ?: t.url).ifEmpty { return }
        act.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url).putExtra(Intent.EXTRA_SUBJECT, t.view?.title ?: t.title), "Поделиться"))
    }

    fun copy(text: String) {
        (act.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("url", text))
        toast("Скопировано")
    }

    fun toggleDesktop() {
        val t = activeTab() ?: return
        t.desktop = !t.desktop
        t.view?.let { v ->
            v.settings.userAgentString = if (t.desktop) desktopUA else defaultUA
            v.settings.loadWithOverviewMode = true
            v.reload()
        }
        pushState()
    }

    fun applyPageSettings() {
        for (t in tabs.values) t.view?.let { v ->
            v.settings.textZoom = settings.optInt("textZoom", 100)
            v.settings.minimumFontSize = settings.optInt("minFontSize", 0).coerceAtLeast(1)
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) WebSettingsCompat.setAlgorithmicDarkeningAllowed(v.settings, settings.optBoolean("forceDarkSites"))
        }
    }

    fun clearData(o: JSONObject) {
        if (o.optBoolean("history")) { history.clear(); store.write("history.json", "[]") }
        if (o.optBoolean("searches")) { searches.clear(); store.write("searches.json", "[]") }
        if (o.optBoolean("cache")) tabs.values.firstOrNull { it.view != null }?.view?.clearCache(true) ?: WebView(act).apply { clearCache(true); destroy() }
        if (o.optBoolean("cookies")) { CookieManager.getInstance().removeAllCookies(null); WebStorage.getInstance().deleteAllData() }
    }

    fun counts() = jsonOf("history" to history.size, "searches" to searches.size)

    // долгое нажатие на ссылку или картинку — меню действий в интерфейсе
    private fun longPress(wv: WebView, tab: Tab): Boolean {
        val r = wv.hitTestResult
        val image = if (r.type == WebView.HitTestResult.IMAGE_TYPE || r.type == WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE) r.extra else null
        when (r.type) {
            WebView.HitTestResult.SRC_ANCHOR_TYPE -> act.emit("context", jsonOf("link" to r.extra, "private" to tab.isPrivate))
            WebView.HitTestResult.IMAGE_TYPE -> act.emit("context", jsonOf("image" to image, "private" to tab.isPrivate))
            WebView.HitTestResult.SRC_IMAGE_ANCHOR_TYPE -> {
                val msg = Handler(Looper.getMainLooper()) { m ->
                    act.emit("context", jsonOf("link" to m.data.getString("url"), "image" to image, "title" to m.data.getString("title"), "private" to tab.isPrivate)); true
                }.obtainMessage()
                wv.requestFocusNodeHref(msg)
            }
            else -> return false
        }
        return true
    }

    fun toast(text: String) = Toast.makeText(act, text, Toast.LENGTH_SHORT).show()

    private fun openExternal(url: String): Boolean {
        return try {
            val intent = if (url.startsWith("intent:")) Intent.parseUri(url, Intent.URI_INTENT_SCHEME).apply {
                addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null
            } else Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
            act.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            // у intent:// бывает запасной адрес для браузера
            if (url.startsWith("intent:")) runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url") }.getOrNull()
                ?.let { fb -> activeTab()?.let { loadInto(it, fb) } }
            false
        } catch (e: Exception) {
            false
        }
    }

    // ---------- клиенты страниц ----------

    inner class PageClient(private val tab: Tab) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url.toString()
            if (url.startsWith("essential-action:")) { pageAction(view, tab, url); return true }
            val scheme = request.url.scheme?.lowercase() ?: ""
            if (scheme == "http" || scheme == "https") {
                if (request.isForMainFrame && needsHttpWarning(url)) { view.loadUrl(warnUrl("http", url)); return true }
                if (request.isForMainFrame) tab.requested = url
                return false
            }
            if (scheme in listOf("about", "data", "blob", "javascript", "file")) return false
            openExternal(url) // tel:, mailto:, intent:, tg: и прочее — в своих приложениях
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            tab.url = url
            tab.loading = true
            if (!url.startsWith(ASSETS)) tab.favicon = iconOf(url)
            pushState()
        }

        override fun onPageFinished(view: WebView, url: String) {
            tab.loading = false
            tab.url = url
            tab.title = view.title ?: tab.title
            if (!tab.isPrivate) {
                addHistory(url, view.title ?: "")
                searchFromUrl(url)?.let { rememberSearch(it) }
            }
            if (url == NEWTAB_URL) refreshNewtab(view)
            pushState()
            saveSessionLater()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            tab.url = url
            pushState()
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            val host = hostOf(error.url)
            if (host in certAllowed) return handler.proceed()
            handler.cancel()
            // предупреждение — только если сломан сертификат самой страницы, а не картинки или скрипта на ней
            if (host.isNotEmpty() && host == hostOf(tab.requested)) {
                val name = when (error.primaryError) {
                    SslError.SSL_EXPIRED -> "ERR_CERT_DATE_INVALID"
                    SslError.SSL_NOTYETVALID -> "ERR_CERT_DATE_INVALID"
                    SslError.SSL_IDMISMATCH -> "ERR_CERT_COMMON_NAME_INVALID"
                    SslError.SSL_UNTRUSTED -> "ERR_CERT_AUTHORITY_INVALID"
                    else -> "ERR_CERT_INVALID"
                }
                view.loadUrl(warnUrl("cert", error.url, name))
            }
        }

        // своя страница ошибки вместо системной «Webpage not available»
        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
            if (!request.isForMainFrame) return
            val url = request.url.toString()
            if (!url.startsWith("http")) return
            val code = error.description?.toString() ?: ""
            view.loadUrl("${ASSETS}error.html?url=${Uri.encode(url)}&code=${Uri.encode(code)}")
        }

        // упавшая страница не должна ронять весь браузер: выгружаем вкладку, при открытии она загрузится заново
        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            tabs.values.filter { it.view === view }.forEach { t -> t.url = view.url ?: t.url; t.view = null }
            if (shown === view) shown = null
            act.pages.removeView(view)
            view.destroy()
            main.post { showActive(); pushState() }
            return true
        }
    }

    inner class ChromeClient(private val tab: Tab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            tab.progress = newProgress
            pushState()
        }

        override fun onReceivedTitle(view: WebView, title: String?) {
            tab.title = title ?: ""
            if (!tab.isPrivate) view.url?.let { addHistory(it, tab.title) }
            pushState()
        }

        override fun onReceivedIcon(view: WebView, icon: Bitmap) {
            val url = view.url ?: return
            if (!tab.isPrivate) rememberFavicon(url, icon)
            tab.favicon = iconOf(url) ?: tab.favicon
            pushState()
        }

        // window.open и target=_blank — новой вкладкой (только по нажатию пользователя)
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) return false
            val t = createTab("", activate = true, private = tab.isPrivate, opener = tab.id)
            val wv = ensureView(t, load = false)
            (resultMsg.obj as WebView.WebViewTransport).webView = wv
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView) {
            tabs.values.firstOrNull { it.view === window }?.let { closeTab(it.id) }
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            act.pickFiles(callback, params)
            return true
        }

        // камера и микрофон: настройка «спрашивать/разрешать/блокировать», вопрос — в интерфейсе, потом системное разрешение
        override fun onPermissionRequest(request: PermissionRequest) {
            val wanted = request.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
            if (wanted.isEmpty()) return request.deny()
            val origin = request.origin.toString()
            decide(origin, "media", if (wanted.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) "камера и микрофон" else "микрофон") { ok ->
                if (!ok) return@decide request.deny()
                val sys = mutableListOf<String>()
                if (wanted.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) sys.add(android.Manifest.permission.CAMERA)
                if (wanted.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) sys.add(android.Manifest.permission.RECORD_AUDIO)
                act.requestRuntime(sys.toTypedArray()) { granted -> if (granted) request.grant(wanted.toTypedArray()) else request.deny() }
            }
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            decide(origin, "geolocation", "местоположение") { ok ->
                if (!ok) return@decide callback.invoke(origin, false, false)
                act.requestRuntime(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION)) { granted ->
                    callback.invoke(origin, granted, false)
                }
            }
        }

        override fun onShowCustomView(view: android.view.View, callback: CustomViewCallback) = act.showCustom(view, callback)
        override fun onHideCustomView() = act.hideCustom()
    }

    private fun decide(origin: String, perm: String, label: String, cb: (Boolean) -> Unit) {
        val mode = settings.optJSONObject("permissions")?.optString(perm, "ask") ?: "ask"
        if (mode != "ask") return cb(mode == "allow")
        val memo = "$origin|$perm"
        sitePerms[memo]?.let { return cb(it) }
        act.ask(jsonOf("type" to "permission", "origin" to hostOf(origin).ifEmpty { origin }, "what" to label)) { ok ->
            sitePerms[memo] = ok
            cb(ok)
        }
    }

    // ---------- состояние для интерфейса ----------

    private var statePending = false
    fun pushState() {
        if (statePending) return
        statePending = true
        main.postDelayed({ statePending = false; act.emit("state", state()) }, 40)
    }

    fun state(): JSONObject {
        val cur = activeTab()
        val v = cur?.view
        val url = displayUrl(v?.url ?: cur?.url)
        val sp = space()
        return jsonOf(
            "spaces" to JSONArray(spaces.map { jsonOf("id" to it.id, "name" to it.name, "icon" to it.icon, "theme" to it.theme, "count" to it.tabIds.size) }),
            "activeSpace" to activeSpace,
            "tabs" to JSONArray(sp.tabIds.mapNotNull { tabs[it] }.map { t ->
                jsonOf("id" to t.id, "title" to (t.view?.title ?: t.title).ifEmpty { displayUrl(t.view?.url ?: t.url).ifEmpty { "Новая вкладка" } },
                    "url" to displayUrl(t.view?.url ?: t.url), "favicon" to (t.favicon ?: iconOf(t.view?.url ?: t.url)), "private" to t.isPrivate, "sleeping" to (t.view == null))
            }),
            "activeTab" to sp.activeTab,
            "nav" to jsonOf(
                "url" to url,
                "title" to (v?.title ?: cur?.title ?: ""),
                "loading" to (cur?.loading ?: false),
                "progress" to (cur?.progress ?: 100),
                "canBack" to (v?.canGoBack() ?: false),
                "canForward" to (v?.canGoForward() ?: false),
                "secure" to when {
                    url.isEmpty() -> "newtab"
                    (v?.url ?: "").startsWith(WARN_URL) -> "warn"
                    url.startsWith("https:") -> "https"
                    else -> "http"
                },
                "pinned" to (url.isNotEmpty() && essentials.any { it.optString("url") == url }),
                "desktop" to (cur?.desktop ?: false),
                "private" to (cur?.isPrivate ?: false),
            ),
            "essentials" to withIcons(essentials),
            "downloads" to downloads.summary(),
            "update" to updater.state(),
            "alerts" to alerts.state(),
            "settings" to settings,
            "insets" to act.insetsJson(),
            "version" to BuildConfig.VERSION_NAME,
            "privateIsolated" to WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE),
        )
    }

    // список вкладок со снимками — только когда открывают экран вкладок
    fun tabsWithThumbs(): JSONArray {
        activeTab()?.let { t -> t.view?.let { t.thumb = snapshot(it) } }
        return JSONArray(space().tabIds.mapNotNull { tabs[it] }.map { t ->
            jsonOf("id" to t.id, "title" to (t.view?.title ?: t.title).ifEmpty { "Новая вкладка" }, "url" to displayUrl(t.view?.url ?: t.url),
                "favicon" to (t.favicon ?: iconOf(t.view?.url ?: t.url)), "private" to t.isPrivate, "thumb" to t.thumb)
        })
    }

    // ---------- сессия ----------

    private val pendingSaves = mutableMapOf<String, Runnable>()
    private fun saveLater(key: String, delay: Long = 1500, fn: () -> Unit) {
        pendingSaves.remove(key)?.let { main.removeCallbacks(it) }
        val r = Runnable { pendingSaves.remove(key); fn() }
        pendingSaves[key] = r
        main.postDelayed(r, delay)
    }

    fun saveSessionLater() = saveLater("session", 2000) { saveSession() }

    fun saveSession() {
        val o = jsonOf(
            "activeSpace" to spaces.indexOfFirst { it.id == activeSpace },
            "spaces" to JSONArray(spaces.map { sp ->
                val kept = sp.tabIds.mapNotNull { tabs[it] }.filter { !it.isPrivate }
                jsonOf("name" to sp.name, "icon" to sp.icon, "theme" to sp.theme,
                    "active" to kept.indexOfFirst { it.id == sp.activeTab }.coerceAtLeast(0),
                    "tabs" to JSONArray(kept.map { t -> jsonOf("url" to (t.view?.url ?: t.url), "title" to (t.view?.title ?: t.title), "favicon" to t.favicon) }))
            }),
        )
        store.write("session.json", o.toString())
    }

    // всё, что ждёт записи, — сразу (приложение уходит в фон и может быть закрыто системой)
    fun saveNow() {
        for (r in pendingSaves.values.toList()) { main.removeCallbacks(r); r.run() }
        pendingSaves.clear()
        saveSession()
        CookieManager.getInstance().flush()
    }

    private fun restoreSession() {
        val s = store.obj("session.json")
        val saved = s?.optJSONArray("spaces")?.objects().orEmpty()
        if (saved.isEmpty()) {
            activeSpace = createSpace().id
            createTab()
            return
        }
        for (o in saved) {
            val sp = createSpace(o.optString("name"), o.optString("icon"), o.optJSONObject("theme"))
            activeSpace = sp.id
            if (settings.optBoolean("restoreSession", true)) {
                for (t in o.optJSONArray("tabs")?.objects().orEmpty()) createTab(t.optString("url").ifEmpty { NEWTAB_URL }, activate = false, spaceId = sp.id, restore = t)
                sp.activeTab = sp.tabIds.getOrNull(o.optInt("active")) ?: sp.tabIds.firstOrNull()
            }
        }
        val sp = spaces.getOrNull(s!!.optInt("activeSpace")) ?: spaces.first()
        switchSpace(sp.id)
    }
}

// null — ввод не похож на адрес, его надо искать (как parseUrl в main.js)
fun parseUrl(input: String): String? {
    val s = input.trim()
    if (Regex("^[a-z][a-z0-9+.-]*://", RegexOption.IGNORE_CASE).containsMatchIn(s) || Regex("^(about|data):", RegexOption.IGNORE_CASE).containsMatchIn(s)) return s
    if (Regex("^(localhost|127\\.0\\.0\\.1)(:\\d+)?(/.*)?$", RegexOption.IGNORE_CASE).matches(s)) return "http://$s"
    if (!s.contains(Regex("\\s")) && Regex("^[^/]+\\.[a-zа-я]{2,}(:\\d+)?(/.*)?$", RegexOption.IGNORE_CASE).matches(s)) return "https://$s"
    return null
}
