#!/usr/bin/env bash
# Emulator check of the water widget: add it, tap + offline, go online, and confirm exactly one row in Supabase.
# Runs on the app's single account and removes only what it adds (see supabase/functions/e2e-hydration).
# Then a second offline tap with the app brought to the front as the network returns, so the widget's own sync and
# the app's queue flush race each other: still exactly one row for that tap (client_id dedupe).
set -x
OUT=native/e2e/out; mkdir -p $OUT
FN=https://vrrlqxqdtuorluvenofs.supabase.co/functions/v1/e2e-hydration
call() { # $1 = action
  local T; T=$(curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=kata-e2e" | jq -r .value)
  curl -sS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"action\":\"$1\",\"since\":\"$SINCE\"${2:+,$2}}" $FN
}
count() { call count | jq -r .count; }
cdp() { local S; S=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_[0-9]*" | head -1); adb forward --remove-all; adb forward tcp:9222 localabstract:$S; node native/e2e/cdp.mjs 9222 "$1" 2>&1 | tee -a $OUT/widget.txt; }
shot() { adb shell screencap -p /sdcard/w.png && adb pull /sdcard/w.png "$OUT/$1.png"; }
ui() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml; }
# Centre of the first node matching a pattern in the UI dump
tap_node() {
  local b; b=$(ui | tr '>' '\n' | grep -iE "$1" | head -1 | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')
  [ -z "$b" ] && { echo "no node for $1"; return 1; }
  set -- $b; adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 )); echo "tapped $1,$2-$3,$4"
}
widget_text() { ui | tr '>' '\n' | grep 'ie.traininglog.app:id/water_text' | grep -o 'text="[^"]*"' | head -1; }
# The widget's total in ml, from "1.75 / 3.0 L"
widget_ml() { local t; t=$(widget_text | sed -E 's/text="([0-9.]+) .*/\1/'); if [ -z "$t" ]; then echo none; else awk -v x="$t" 'BEGIN { printf "%d\n", x * 1000 + 0.5 }'; fi; }
fail=0
check() { if [ "$1" = "$2" ]; then echo "PASS $3 ($1)" | tee -a $OUT/widget-result.txt; else echo "FAIL $3: got '$1', want '$2'" | tee -a $OUT/widget-result.txt; fail=1; fi; }

# The rest-timer run leaves the phone locked with a PIN: unlock and start the app fresh
adb shell input keyevent KEYCODE_WAKEUP; adb shell locksettings clear --old 1111 || true
adb shell wm dismiss-keyguard; adb shell input keyevent 82; sleep 2
adb shell am force-stop ie.traininglog.app
adb shell am start -n ie.traininglog.app/.MainActivity; sleep 25

SINCE=""
export HYD_JSON; HYD_JSON=$(call start)
SINCE=$(echo "$HYD_JSON" | jq -r .since)
echo "$HYD_JSON" | jq -c '{error, ok: (.refresh_token != null), web: (.web_session.access_token != null), since}' | tee $OUT/widget.txt
cleanup() { call cleanup "\"tokens\":[$(echo "$HYD_JSON" | jq -c '.web_session.access_token, .widget_access' | paste -sd,)]" | tee -a $OUT/widget.txt; }
trap cleanup EXIT
cdp hyd-web; sleep 20                 # the app's web view signed in (its own session)
# The app must give the widget its own session by itself once signed in
check "$(cdp hyd-state | grep -c 'signedIn[^a-z]*true')" "1" "app signed the widget in by itself"
cdp hyd-session; sleep 8              # then the test's own widget session, so cleanup can sign it out
cdp hyd-pin; sleep 5; shot w0-pin-dialog; ui > $OUT/w0-pin-dialog.xml
tap_node 'text="(Add|ADD)( to home screen| automatically| AUTOMATICALLY)?"' || tap_node 'resource-id="[^"]*button1"'
sleep 4
adb shell input keyevent KEYCODE_HOME; sleep 8; shot w1-home; ui > $OUT/w1-home.xml
M0=$(widget_ml); echo "widget starts at $M0 ml (today's real total)" | tee -a $OUT/widget-result.txt
[ "$M0" = "none" ] && { echo "FAIL widget not found on the home screen" | tee -a $OUT/widget-result.txt; fail=1; M0=0; }

# --- 1: tap offline, then online: the widget's own sync saves it ---
adb shell cmd connectivity airplane-mode enable; sleep 5
tap_node 'resource-id="ie.traininglog.app:id/water_plus"'; sleep 3; shot w2-offline-tap
check "$(widget_ml)" "$((M0 + 250))" "widget adds 250 ml at once while offline"
check "$(count)" "0" "nothing saved while offline"
adb shell cmd connectivity airplane-mode disable
n=0; for i in $(seq 1 30); do n=$(count); [ "$n" != "0" ] && break; sleep 5; done
sleep 10; check "$(count)" "1" "exactly one row after going online"

# --- 2: tap offline, then online with the app opened at the same moment (worker and app flush race) ---
adb shell cmd connectivity airplane-mode enable; sleep 5
tap_node 'resource-id="ie.traininglog.app:id/water_plus"'; sleep 3
check "$(widget_ml)" "$((M0 + 500))" "second tap shown offline"
adb shell cmd connectivity airplane-mode disable
adb shell am start -n ie.traininglog.app/.MainActivity
for i in $(seq 1 30); do [ "$(count)" = "2" ] && break; sleep 5; done
sleep 20
check "$(count)" "2" "two taps, two rows (no duplicate from the race)"
call count | jq -c '.rows[] | {ml, source, local_date}' | tee -a $OUT/widget.txt
check "$(call count | jq -r '[.rows[].client_id] | unique | length')" "2" "distinct client_ids"
cdp hyd-state
adb shell input keyevent KEYCODE_HOME; sleep 4; shot w3-home-after
check "$(widget_ml)" "$((M0 + 500))" "widget total after sync"
adb logcat -d | grep -iE "KataWater|WM-|AndroidRuntime" | tail -60 > $OUT/widget-logcat.txt
[ $fail = 0 ] && echo "WIDGET E2E: PASS" | tee -a $OUT/widget-result.txt || echo "WIDGET E2E: FAIL" | tee -a $OUT/widget-result.txt
exit 0
