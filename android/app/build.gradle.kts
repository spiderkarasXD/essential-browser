import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Ключ подписи хранится вне репозитория: keystore.properties (в .gitignore) указывает на .jks.
// Без него релиз подписывается отладочным ключом — такой APK не обновит установленный релизный.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "app.essential.browser"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.essential.browser"
        minSdk = 26
        targetSdk = 35
        versionCode = 603
        versionName = "0.6.3"
        // для проверки автообновления: gradlew assembleRelease -PtestVersion=0.6.2 соберёт «старую» версию
        (project.findProperty("testVersion") as String?)?.let { v ->
            versionName = v
            versionCode = v.split('.').fold(0) { acc, part -> acc * 100 + (part.toIntOrNull() ?: 0) } // 0.6.2 → 602
        }
    }

    signingConfigs {
        if (keystoreProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }

    // общие с ПК-версией страницы кладём в assets/ui при сборке (см. copySharedAssets)
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/sharedAssets"))
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}

// Новая вкладка, предупреждение о сертификате, темы, иконки сайтов и список субъектов — те же файлы, что у ПК-версии
val copySharedAssets by tasks.registering(Copy::class) {
    from(rootProject.projectDir.parentFile) {
        include("theme.js", "favicon.js", "newtab.html", "warning.html", "regions.js", "regions.css", "subjects-rf.json")
    }
    from(rootProject.projectDir.parentFile.resolve("build")) { include("icon.png") }
    into(layout.buildDirectory.dir("generated/sharedAssets/ui"))
}
tasks.named("preBuild") { dependsOn(copySharedAssets) }
