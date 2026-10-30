#!/usr/bin/env bash
# Emulator check of the rest timer notification: look, buttons, sync back to the app, lock screen.
set -x
OUT=native/e2e/out; mkdir -p $OUT
APK=native/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r -g $APK
adb shell pm grant ie.traininglog.app android.permission.POST_NOTIFICATIONS || true
adb shell settings put system screen_off_timeout 600000
adb shell am start -n ie.traininglog.app/.MainActivity
sleep 25
SOCK=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | head -1)
adb forward tcp:9222 localabstract:$SOCK
node native/e2e/cdp.mjs 9222 start 2>&1 | tee $OUT/cdp.txt
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell cmd statusbar expand-notifications
sleep 3
adb shell screencap -p /sdcard/s1.png && adb pull /sdcard/s1.png $OUT/1-shade.png
# Tap "+15 s" on the notification
adb shell uiautomator dump /sdcard/ui.xml >/dev/null && adb pull /sdcard/ui.xml $OUT/ui.xml
B=$(grep -o 'text="+15 s"[^>]*bounds="\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]"' $OUT/ui.xml | grep -o 'bounds="[^"]*"' | head -1)
echo "plus bounds: $B"
if [ -n "$B" ]; then
  read X1 Y1 X2 Y2 <<< $(echo $B | grep -o '[0-9]*' | tr '\n' ' ')
  adb shell input tap $(( (X1 + X2) / 2 )) $(( (Y1 + Y2) / 2 ))
fi
sleep 3
adb shell screencap -p /sdcard/s2.png && adb pull /sdcard/s2.png $OUT/2-shade-after-plus15.png
node native/e2e/cdp.mjs 9222 state 2>&1 | tee -a $OUT/cdp.txt
adb shell cmd statusbar collapse
# Lock screen
adb shell locksettings set-pin 1111 || true
adb shell input keyevent KEYCODE_SLEEP
sleep 3
adb shell input keyevent KEYCODE_WAKEUP
sleep 3
adb shell screencap -p /sdcard/s3.png && adb pull /sdcard/s3.png $OUT/3-lockscreen.png
adb shell dumpsys notification --noredact | grep -A3 "pkg=ie.traininglog.app" | head -20 > $OUT/notifications.txt
cat $OUT/notifications.txt
adb logcat -d | grep -iE "RestTimer|traininglog|AndroidRuntime|RemoteViews|Bad notification" | tail -80 > $OUT/logcat.txt
exit 0
