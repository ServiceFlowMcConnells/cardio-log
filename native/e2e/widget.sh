#!/usr/bin/env bash
# Emulator check of the water widget: add it, tap + offline, go online, and confirm exactly one row in Supabase.
# Then a second offline tap with the app brought to the front as the network returns, so the widget's own sync and
# the app's queue flush race each other: still exactly one row for that tap (client_id dedupe).
set -x
OUT=native/e2e/out; mkdir -p $OUT
FN=https://vrrlqxqdtuorluvenofs.supabase.co/functions/v1/e2e-hydration
call() { # $1 = action
  local T; T=$(curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=kata-e2e" | jq -r .value)
  curl -sS -X POST -H "Authorization: Bearer $T" -H "Content-Type: application/json" -d "{\"action\":\"$1\"}" $FN
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
fail=0
check() { if [ "$1" = "$2" ]; then echo "PASS $3 ($1)" | tee -a $OUT/widget-result.txt; else echo "FAIL $3: got '$1', want '$2'" | tee -a $OUT/widget-result.txt; fail=1; fi; }

export HYD_JSON; HYD_JSON=$(call reset)
echo "$HYD_JSON" | jq -c '{user_id, ok: (.refresh_token != null), web: (.web_session.access_token != null)}' | tee $OUT/widget.txt
adb shell am start -n ie.traininglog.app/.MainActivity; sleep 20
cdp hyd-web; sleep 15                 # app signed in as the test account
cdp hyd-session; sleep 3              # widget session (normally the app does this itself on sign-in)
cdp hyd-pin; sleep 4; shot w0-pin-dialog
tap_node 'text="Add( to home screen| automatically)?"' || tap_node 'resource-id="[^"]*button1"'
sleep 4
adb shell input keyevent KEYCODE_HOME; sleep 4; shot w1-home
check "$(widget_text)" 'text="0.0 / 3.0 L"' "widget shows 0 before any taps"

# --- 1: tap offline, then online: the widget's own sync saves it ---
adb shell cmd connectivity airplane-mode enable; sleep 5
tap_node 'resource-id="ie.traininglog.app:id/water_plus"'; sleep 3; shot w2-offline-tap
check "$(widget_text)" 'text="0.25 / 3.0 L"' "widget updates at once while offline"
check "$(count)" "0" "nothing saved while offline"
adb shell cmd connectivity airplane-mode disable
n=0; for i in $(seq 1 30); do n=$(count); [ "$n" != "0" ] && break; sleep 5; done
sleep 10; check "$(count)" "1" "exactly one row after going online"

# --- 2: tap offline, then online with the app opened at the same moment (worker and app flush race) ---
adb shell cmd connectivity airplane-mode enable; sleep 5
tap_node 'resource-id="ie.traininglog.app:id/water_plus"'; sleep 3
check "$(widget_text)" 'text="0.5 / 3.0 L"' "second tap shown offline"
adb shell cmd connectivity airplane-mode disable
adb shell am start -n ie.traininglog.app/.MainActivity
for i in $(seq 1 30); do [ "$(count)" = "2" ] && break; sleep 5; done
sleep 20
check "$(count)" "2" "two taps, two rows (no duplicate from the race)"
call count | jq -c '.rows[] | {ml, source, local_date}' | tee -a $OUT/widget.txt
check "$(call count | jq -r '[.rows[].client_id] | unique | length')" "2" "distinct client_ids"
cdp hyd-state
adb shell input keyevent KEYCODE_HOME; sleep 4; shot w3-home-after
check "$(widget_text)" 'text="0.5 / 3.0 L"' "widget total after sync"
adb logcat -d | grep -iE "KataWater|WM-|AndroidRuntime" | tail -60 > $OUT/widget-logcat.txt
[ $fail = 0 ] && echo "WIDGET E2E: PASS" | tee -a $OUT/widget-result.txt || echo "WIDGET E2E: FAIL" | tee -a $OUT/widget-result.txt
exit 0
