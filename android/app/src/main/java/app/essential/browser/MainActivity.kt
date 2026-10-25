package app.essential.browser

import android.annotation.SuppressLint
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONObject

// Экран браузера: страницы (WebView вкладок) и поверх — интерфейс, сам написанный на HTML (assets/ui).
// В обычном режиме интерфейс — только нижняя панель, а когда открыт поиск, вкладки, меню или настройки —
// он растягивается на весь экран (страница остаётся за ним).
class MainActivity : Activity() {
    lateinit var pages: FrameLayout
    private lateinit var root: FrameLayout
    private lateinit var ui: WebView
    lateinit var b: Browser
    private var uiMode = "bar"
    private var keepBarWithKeyboard = false
    private var insetTop = 0
    private var insetBottom = 0
    private var ime = 0
    private var uiReady = false
    private val queued = mutableListOf<String>()
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private val permCallbacks = mutableMapOf<Int, (Boolean) -> Unit>()
    private val askCallbacks = mutableMapOf<Int, (Boolean) -> Unit>()
    private var nextReq = 100

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun px2dp(v: Int) = (v / resources.displayMetrics.density).toInt()

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        // рисуем под системными панелями сами (edge-to-edge), отступы берём из WindowInsets
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.setDecorFitsSystemWindows(false)
        else @Suppress("DEPRECATION") {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        }
        root = FrameLayout(this)
        pages = FrameLayout(this)
        ui = WebView(this)
        root.addView(pages, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(ui, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(64), Gravity.BOTTOM))
        setContentView(root)
        root.setOnApplyWindowInsetsListener { _, insets -> readInsets(insets); layout(); insets }

        ui.setBackgroundColor(Color.TRANSPARENT)
        ui.isVerticalScrollBarEnabled = false
        ui.overScrollMode = View.OVER_SCROLL_NEVER
        ui.settings.javaScriptEnabled = true
        ui.settings.domStorageEnabled = true
        ui.settings.allowFileAccess = false
        ui.settings.mediaPlaybackRequiresUserGesture = false // сирена тревоги должна звучать сама
        // мост только у интерфейса: страницы сайтов к нему доступа не имеют
        ui.addJavascriptInterface(Bridge(), "Native")
        ui.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url.toString()
                if (u.startsWith("http")) b.createTab(u)
                return true // сам интерфейс никуда не уходит со своей страницы
            }
        }
        ui.webChromeClient = WebChromeClient()
        ui.loadUrl(ASSETS + "index.html")

        b = Browser(this)
        b.start(intent)
    }

    // ---------- раскладка ----------

    private fun readInsets(insets: WindowInsets) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            insetTop = bars.top
            insetBottom = bars.bottom
            ime = insets.getInsets(WindowInsets.Type.ime()).bottom
        } else @Suppress("DEPRECATION") {
            insetTop = insets.systemWindowInsetTop
            val bottom = insets.systemWindowInsetBottom
            insetBottom = minOf(bottom, insets.stableInsetBottom)
            ime = if (bottom > insets.stableInsetBottom + dp(80)) bottom else 0
        }
    }

    private fun layout() {
        val bar = dp(64) + insetBottom
        val keyboard = ime > 0
        val lp = ui.layoutParams as FrameLayout.LayoutParams
        val plp = pages.layoutParams as FrameLayout.LayoutParams
        ui.visibility = View.VISIBLE
        when {
            uiMode == "full" -> { lp.height = ViewGroup.LayoutParams.MATCH_PARENT; lp.bottomMargin = if (keyboard) ime else 0; plp.bottomMargin = bar }
            keyboard && keepBarWithKeyboard -> { lp.height = dp(64); lp.bottomMargin = ime; plp.bottomMargin = ime + dp(64) }
            keyboard -> { ui.visibility = View.GONE; plp.bottomMargin = ime } // печатают на сайте — панель прячется за клавиатурой
            else -> { lp.height = bar; lp.bottomMargin = 0; plp.bottomMargin = bar }
        }
        plp.topMargin = insetTop
        ui.layoutParams = lp
        pages.layoutParams = plp
        if (::b.isInitialized) emit("insets", insetsJson())
    }

    fun insetsJson() = jsonOf("top" to px2dp(insetTop), "bottom" to px2dp(insetBottom), "keyboard" to (ime > 0))

    // фон за страницей и под строкой состояния — градиент пространства, как в Zen
    fun applyTheme(theme: JSONObject) {
        val colors = theme.optJSONArray("colors")?.strings().orEmpty().mapNotNull { runCatching { Color.parseColor(it) }.getOrNull() }
        val light = theme.optString("mode") == "light"
        val base = if (light) Color.parseColor("#f4f3f8") else Color.parseColor("#121218")
        val strength = theme.optInt("strength", 55) / 100f
        fun mix(c: Int) = Color.rgb(
            (Color.red(c) * strength + Color.red(base) * (1 - strength)).toInt(),
            (Color.green(c) * strength + Color.green(base) * (1 - strength)).toInt(),
            (Color.blue(c) * strength + Color.blue(base) * (1 - strength)).toInt(),
        )
        val a = mix(colors.getOrElse(0) { Color.parseColor(COLORS[0]) })
        val c2 = mix(colors.getOrElse(1) { colors.getOrElse(0) { base } })
        root.background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(a, base, c2))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (light) flags else 0, flags)
        }
    }

    // ---------- связь с интерфейсом ----------

    fun emit(event: String, data: Any?) {
        val js = "window.app && app.on(${JSONObject.quote(event)}, ${toJson(data)})"
        if (uiReady) ui.evaluateJavascript(js, null) else queued.add(js)
    }

    // вопрос пользователю в интерфейсе (разрешения сайтов): ответ придёт командой answer
    fun ask(question: JSONObject, cb: (Boolean) -> Unit) {
        val id = nextReq++
        askCallbacks[id] = cb
        emit("ask", question.put("id", id))
    }

    inner class Bridge {
        @JavascriptInterface
        fun post(cmd: String, args: String, cb: Int) {
            runOnUiThread {
                val result = try {
                    command(cmd, if (args.isEmpty()) JSONObject() else JSONObject(args))
                } catch (e: Exception) {
                    jsonOf("error" to (e.message ?: e.toString()))
                }
                if (cb > 0) ui.evaluateJavascript("app.reply($cb, ${toJson(result)})", null)
            }
        }
    }

    private fun command(cmd: String, a: JSONObject): Any? {
        when (cmd) {
            "ready" -> {
                uiReady = true
                queued.forEach { ui.evaluateJavascript(it, null) }
                queued.clear()
                b.applyTheme()
                return b.state()
            }
            "ui" -> {
                uiMode = a.optString("mode", "bar")
                keepBarWithKeyboard = a.optBoolean("keyboard")
                layout()
                if (uiMode == "full") ui.requestFocus()
                // экран поиска закрылся — клавиатура не должна остаться висеть над сайтом
                else if (!keepBarWithKeyboard) {
                    (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(ui.windowToken, 0)
                    b.activeTab()?.view?.requestFocus()
                }
            }
            "go" -> b.go(a.optString("text"), a.optBoolean("newTab"), a.optBoolean("private"))
            "open" -> {
                val url = a.optString("url")
                if (a.optBoolean("newTab")) b.createTab(url, activate = !a.optBoolean("background"), private = a.optBoolean("private"))
                else b.activeTab()?.let { b.loadInto(it, url) }
            }
            "suggest" -> return b.suggest(a.optString("q"))
            "forgetSearch" -> b.forgetSearch(a.optString("q"))
            "back" -> b.activeTab()?.view?.let { if (it.canGoBack()) it.goBack() }
            "forward" -> b.activeTab()?.view?.let { if (it.canGoForward()) it.goForward() }
            "reload" -> b.activeTab()?.view?.let { if (b.activeTab()!!.loading) it.stopLoading() else it.reload() }
            "newTab" -> b.createTab(private = a.optBoolean("private"))
            "switchTab" -> b.switchTab(a.optInt("id"))
            "closeTab" -> b.closeTab(a.optInt("id"))
            "closeAll" -> b.closeAll(a.optBoolean("private"))
            "reopen" -> b.reopenClosed()
            "tabs" -> return b.tabsWithThumbs()
            "space.switch" -> b.switchSpace(a.optInt("id"))
            "space.create" -> { val sp = b.createSpace(); b.switchSpace(sp.id); b.saveSessionLater() }
            "space.update" -> {
                val sp = b.spaces.firstOrNull { it.id == a.optInt("id") } ?: return null
                a.optString("name").takeIf { it.isNotBlank() }?.let { sp.name = it.take(40) }
                a.optString("icon").takeIf { it in ICONS }?.let { sp.icon = it }
                a.optJSONObject("theme")?.let { b.sanitizeTheme(it)?.let { t -> sp.theme = t }; if (sp.id == b.activeSpace) applyTheme(sp.theme); b.refreshAllNewtabs() }
                b.saveSessionLater(); b.pushState()
            }
            "space.delete" -> { b.deleteSpace(a.optInt("id")); b.saveSessionLater() }
            "pin.toggle" -> b.togglePin()
            "pin.add" -> b.addEssential(a.optString("url"), a.optString("title"))
            "pin.remove" -> b.removeEssential(a.optString("url"))
            "find" -> b.find(a.optString("q"), if (a.has("forward")) a.optBoolean("forward") else null)
            "findClose" -> b.findClose()
            "share" -> b.share()
            "copy" -> b.copy(a.optString("text"))
            "desktop" -> b.toggleDesktop()
            "settings" -> return jsonOf(
                "settings" to b.settings, "engines" to JSONObject(ENGINES.mapValues { it.value.first } as Map<*, *>),
                "presets" to THEME_PRESETS, "icons" to org.json.JSONArray(ICONS), "counts" to b.counts(),
                "space" to b.space().let { jsonOf("id" to it.id, "name" to it.name, "icon" to it.icon, "theme" to it.theme) },
                "version" to BuildConfig.VERSION_NAME, "isDefault" to isDefaultBrowser(),
            )
            "set" -> setSetting(a.optString("key"), a.opt("value"))
            "clear" -> { b.clearData(a); return b.counts() }
            "downloads" -> return b.downloads.list()
            "download" -> b.downloads.action(a.optLong("id"), a.optString("action"))
            "update.check" -> b.updater.check()
            "update.install" -> b.updater.install()
            "alerts.regions" -> return b.alerts.regions()
            "alerts.set" -> b.alerts.set(a)
            "alerts.test" -> emit("alert", jsonOf("kind" to "test", "region" to b.settings.optString("alertsRegionName"), "sound" to b.settings.optBoolean("alertsSound", true)))
            "notifications" -> requestNotifications()
            "answer" -> askCallbacks.remove(a.optInt("id"))?.invoke(a.optBoolean("ok"))
            "defaultBrowser" -> requestDefaultBrowser()
            "onboarded" -> { b.settings.put("onboarded", true); b.saveSettings() }
            "toast" -> b.toast(a.optString("text"))
            "openDownloads" -> runCatching { startActivity(Intent(android.app.DownloadManager.ACTION_VIEW_DOWNLOADS)) }
        }
        return null
    }

    // настройки из интерфейса: только известные ключи и подходящие типы
    private fun setSetting(key: String, value: Any?) {
        val s = b.settings
        if (!s.has(key) || value == null) return
        val ok = when (val cur = s.get(key)) {
            is Boolean -> value is Boolean
            is Int, is Long, is Double -> value is Number
            is String -> value is String
            is JSONObject -> value is JSONObject
            is org.json.JSONArray -> value is org.json.JSONArray
            else -> cur.javaClass == value.javaClass
        }
        if (!ok) return
        when (key) {
            "searchEngine" -> if (value !in ENGINES.keys) return
            "newTabStyle" -> if (value !in listOf("page", "spotlight")) return
            "textZoom" -> s.put(key, (value as Number).toInt().coerceIn(50, 200)).also { b.saveSettings(); b.applyPageSettings(); return }
            "minFontSize" -> s.put(key, (value as Number).toInt().coerceIn(0, 24)).also { b.saveSettings(); b.applyPageSettings(); return }
            "clock" -> {
                val c = JSONObject(s.getJSONObject("clock").toString())
                val v = value as JSONObject
                for ((k, opts) in CLOCK_OPTIONS) v.optString(k).takeIf { it in opts }?.let { c.put(k, it) }
                for (k in listOf("seconds", "h12", "date")) if (v.has(k)) c.put(k, v.optBoolean(k))
                s.put("clock", c); b.saveSettings(); b.refreshAllNewtabs(); b.pushState(); return
            }
            "permissions" -> {
                val p = JSONObject(s.getJSONObject("permissions").toString())
                val v = value as JSONObject
                for (k in listOf("media", "geolocation")) v.optString(k).takeIf { it in listOf("ask", "allow", "block") }?.let { p.put(k, it) }
                s.put("permissions", p); b.saveSettings(); return
            }
            "httpAllowed" -> if ((value as org.json.JSONArray).length() != 0) return // из интерфейса — только «сбросить»
        }
        s.put(key, value)
        b.saveSettings()
        when (key) {
            "searchEngine" -> b.refreshAllNewtabs()
            "forceDarkSites" -> b.applyPageSettings()
        }
        b.pushState()
    }

    // ---------- системное ----------

    private fun isDefaultBrowser(): Boolean {
        val r = packageManager.resolveActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com")), PackageManager.MATCH_DEFAULT_ONLY)
        return r?.activityInfo?.packageName == packageName
    }

    private fun requestDefaultBrowser() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val rm = getSystemService(RoleManager::class.java)
            if (rm.isRoleAvailable(RoleManager.ROLE_BROWSER) && !rm.isRoleHeld(RoleManager.ROLE_BROWSER)) {
                startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_BROWSER), REQ_ROLE)
                return
            }
        }
        runCatching { startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) }
    }

    private fun requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33) requestRuntime(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS)) {}
    }

    fun requestRuntime(perms: Array<String>, cb: (Boolean) -> Unit) {
        if (perms.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) return cb(true)
        val id = nextReq++
        permCallbacks[id] = cb
        requestPermissions(perms, id)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        permCallbacks.remove(requestCode)?.invoke(grantResults.isNotEmpty() && grantResults.any { it == PackageManager.PERMISSION_GRANTED })
    }

    fun pickFiles(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams) {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        try {
            startActivityForResult(params.createIntent(), REQ_FILE)
        } catch (e: Exception) {
            fileCallback = null
            callback.onReceiveValue(null)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQ_FILE -> {
                fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
                fileCallback = null
            }
            REQ_ROLE -> b.pushState()
        }
    }

    // видео на весь экран
    fun showCustom(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (customView != null) return callback.onCustomViewHidden()
        customView = view
        customCallback = callback
        view.setBackgroundColor(Color.BLACK)
        root.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else @Suppress("DEPRECATION") {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        }
    }

    fun hideCustom() {
        val v = customView ?: return
        root.removeView(v)
        customView = null
        customCallback?.onCustomViewHidden()
        customCallback = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.insetsController?.show(WindowInsets.Type.systemBars())
        else @Suppress("DEPRECATION") {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        when {
            customView != null -> hideCustom()
            uiMode == "full" -> emit("back", null) // интерфейс сам закроет открытый экран
            b.handleBack() -> {}
            else -> moveTaskToBack(true)
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        b.openIntent(intent)
    }

    override fun onPause() {
        super.onPause()
        b.saveNow()
    }

    override fun onResume() {
        super.onResume()
        if (::b.isInitialized) b.pushState()
    }

    companion object {
        private const val REQ_FILE = 1
        private const val REQ_ROLE = 2
    }
}

fun Browser.applyTheme() = act.applyTheme(space().theme)
