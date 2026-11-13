// Runs in CI after `npx cap add android`: copies the native rest timer code in and patches the manifest.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("android/app/src/main");
const pkgDir = path.join(root, "java/ie/traininglog/app");
fs.mkdirSync(pkgDir, { recursive: true });
for (const f of fs.readdirSync("overlay/java")) fs.copyFileSync(path.join("overlay/java", f), path.join(pkgDir, f));
for (const dir of fs.readdirSync("overlay/res")) {
  fs.mkdirSync(path.join(root, "res", dir), { recursive: true });
  for (const f of fs.readdirSync(path.join("overlay/res", dir))) fs.copyFileSync(path.join("overlay/res", dir, f), path.join(root, "res", dir, f));
}

const mf = path.join(root, "AndroidManifest.xml");
let xml = fs.readFileSync(mf, "utf8");
const perms = [
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.VIBRATE" />',
  '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
  '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" />',
  // Barcode scanning in the food log (the web view asks for the camera; Capacitor turns that into this permission)
  '<uses-permission android:name="android.permission.CAMERA" />',
  // Health Connect: steps and sleep from before the app was connected (the plugin declares the read permissions)
  '<uses-permission android:name="android.permission.health.READ_HEALTH_DATA_HISTORY" />',
];
for (const p of perms) if (!xml.includes(p.split('"')[1])) xml = xml.replace("</manifest>", `    ${p}\n</manifest>`);
if (!xml.includes("android.hardware.camera")) xml = xml.replace("</manifest>", '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>');
if (!xml.includes("RestAlarmReceiver")) xml = xml.replace("</application>", '        <receiver android:name=".RestAlarmReceiver" android:exported="false" />\n    </application>');
// Water widget: the provider, its tap/midnight receiver
if (!xml.includes(".WaterWidget")) xml = xml.replace("</application>", `        <receiver android:name=".WaterWidget" android:exported="true" android:label="Kata water">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/water_widget_info" />
        </receiver>
        <receiver android:name=".WaterReceiver" android:exported="false" />
    </application>`);
if (!xml.includes("RestActionReceiver")) xml = xml.replace("</application>", '        <receiver android:name=".RestActionReceiver" android:exported="false" />\n    </application>');
fs.writeFileSync(mf, xml);

// Health Connect shows a privacy policy link in its permission screen; point it at the site's page
const strings = path.join(root, "res/values/strings.xml");
let sx = fs.readFileSync(strings, "utf8");
if (!sx.includes("water_widget_description")) sx = sx.replace("</resources>", '    <string name="water_widget_description">Water today, with a one-tap +</string>\n</resources>');
if (!sx.includes("health_connect_privacy_policy_url")) sx = sx.replace("</resources>", '    <string name="health_connect_privacy_policy_url">https://training-log-coach.vercel.app/privacy.html</string>\n</resources>');
fs.writeFileSync(strings, sx);

// Health Connect needs Android 8 (API 26). Keep targeting API 34 so the app isn't forced edge-to-edge (the
// layout already handles the status bar), while compiling against the SDK the plugins need.
const vars = "android/variables.gradle";
let v = fs.readFileSync(vars, "utf8");
v = v.replace(/minSdkVersion = \d+/, "minSdkVersion = 26").replace(/targetSdkVersion = \d+/, "targetSdkVersion = 34");
fs.writeFileSync(vars, v);

// Version code from the CI run number so each APK installs over the last (same signing key permitting)
const gradle = "android/app/build.gradle";
let g = fs.readFileSync(gradle, "utf8");
const run = process.env.GITHUB_RUN_NUMBER ?? "1";
g = g.replace(/versionCode \d+/, `versionCode ${run}`).replace(/versionName "[^"]*"/, `versionName "1.0.${run}"`);
// Water widget: background sync (WorkManager; Worker needs ListenableFuture from Guava at compile time) and the
// encrypted session store
if (!g.includes("androidx.work:work-runtime")) g = g.replace(/dependencies\s*\{/, `dependencies {
    implementation "androidx.work:work-runtime:2.10.0"
    implementation "androidx.security:security-crypto:1.0.0"
    implementation "com.google.guava:guava:32.1.3-android"`);
if (!g.includes("checkReleaseBuilds")) g = g.replace(/android\s*\{/, "android {\n    lint { checkReleaseBuilds false; abortOnError false }");
fs.writeFileSync(gradle, g);
console.log("patched android project, versionCode", run);
