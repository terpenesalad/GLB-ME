import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Version comes from the git tag in CI (v1.2.3 -> 1.2.3); falls back for local builds.
val appVersionName: String = (findProperty("appVersionName") as String?)
    ?: System.getenv("APP_VERSION_NAME")
    ?: "1.0.0"
val appVersionCode: Int = appVersionName.split('.', '-')
    .mapNotNull { it.toIntOrNull() }
    .let { p -> (p.getOrElse(0) { 1 } * 10000) + (p.getOrElse(1) { 0 } * 100) + p.getOrElse(2) { 0 } }

// Release signing: prefer secrets supplied by CI (RELEASE_KEYSTORE_BASE64 & co.),
// otherwise use the project keystore in /signing so every build installs over the last one.
val ciKeystore: File? = System.getenv("RELEASE_KEYSTORE_BASE64")?.takeIf { it.isNotBlank() }?.let {
    val f = layout.buildDirectory.file("ci-release.jks").get().asFile
    f.parentFile.mkdirs()
    f.writeBytes(Base64.getMimeDecoder().decode(it))
    f
}

android {
    namespace = "app.glbandme"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.glbandme"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersionName
    }

    signingConfigs {
        create("release") {
            if (ciKeystore != null) {
                storeFile = ciKeystore
                storePassword = System.getenv("RELEASE_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("RELEASE_KEY_ALIAS")
                keyPassword = System.getenv("RELEASE_KEY_PASSWORD")
            } else {
                storeFile = rootProject.file("signing/release.jks")
                storePassword = "glbandme"
                keyAlias = "glbandme"
                keyPassword = "glbandme"
            }
            enableV1Signing = true
            enableV2Signing = true
            enableV3Signing = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.getByName("release")
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources.excludes += setOf("META-INF/*.kotlin_module", "kotlin/**", "DebugProbesKt.bin")
    }

    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
}

kotlin {
    jvmToolchain(17)
}

base {
    archivesName.set("GLB-ME-$appVersionName")
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
