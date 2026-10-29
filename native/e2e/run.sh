#!/usr/bin/env bash
# Emulator check of the rest timer: install, open, call the plugin through the bridge, inspect notifications.
set -x
OUT=native/e2e/out; mkdir -p $OUT
APK=native/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r -g $APK
adb shell pm grant ie.traininglog.app android.permission.POST_NOTIFICATIONS || true
adb logcat -c
adb shell am start -n ie.traininglog.app/.MainActivity
sleep 25
adb shell screencap -p /sdcard/app.png && adb pull /sdcard/app.png $OUT/1-app.png
PID=$(adb shell pidof ie.traininglog.app | tr -d '\r')
SOCK=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | head -1)
echo "pid=$PID sock=$SOCK"
adb forward tcp:9222 localabstract:$SOCK
node native/e2e/cdp.mjs 9222 2>&1 | tee $OUT/cdp.txt
sleep 3
adb shell dumpsys notification --noredact | grep -A12 "pkg=ie.traininglog.app" | head -60 > $OUT/notifications.txt
cat $OUT/notifications.txt
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell cmd statusbar expand-notifications
sleep 3
adb shell screencap -p /sdcard/shade.png && adb pull /sdcard/shade.png $OUT/2-shade-countdown.png
adb shell cmd statusbar collapse
sleep 50
adb shell cmd statusbar expand-notifications
sleep 3
adb shell screencap -p /sdcard/shade2.png && adb pull /sdcard/shade2.png $OUT/3-shade-after.png
adb shell dumpsys notification --noredact | grep -A12 "pkg=ie.traininglog.app" | head -60 > $OUT/notifications-after.txt
cat $OUT/notifications-after.txt
adb shell dumpsys alarm | grep -B2 -A6 ie.traininglog.app | head -40 > $OUT/alarms.txt
adb logcat -d | grep -iE "Capacitor|RestTimer|traininglog|chromium.*Uncaught|AndroidRuntime" | tail -200 > $OUT/logcat.txt
exit 0
