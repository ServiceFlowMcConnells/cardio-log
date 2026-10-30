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
];
for (const p of perms) if (!xml.includes(p.split('"')[1])) xml = xml.replace("</manifest>", `    ${p}\n</manifest>`);
if (!xml.includes("android.hardware.camera")) xml = xml.replace("</manifest>", '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n</manifest>');
if (!xml.includes("RestAlarmReceiver")) xml = xml.replace("</application>", '        <receiver android:name=".RestAlarmReceiver" android:exported="false" />\n    </application>');
if (!xml.includes("RestActionReceiver")) xml = xml.replace("</application>", '        <receiver android:name=".RestActionReceiver" android:exported="false" />\n    </application>');
fs.writeFileSync(mf, xml);

// Version code from the CI run number so each APK installs over the last (same signing key permitting)
const gradle = "android/app/build.gradle";
let g = fs.readFileSync(gradle, "utf8");
const run = process.env.GITHUB_RUN_NUMBER ?? "1";
g = g.replace(/versionCode \d+/, `versionCode ${run}`).replace(/versionName "[^"]*"/, `versionName "1.0.${run}"`);
if (!g.includes("checkReleaseBuilds")) g = g.replace(/android\s*\{/, "android {\n    lint { checkReleaseBuilds false; abortOnError false }");
fs.writeFileSync(gradle, g);
console.log("patched android project, versionCode", run);
