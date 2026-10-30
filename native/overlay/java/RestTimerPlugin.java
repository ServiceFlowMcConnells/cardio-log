package ie.traininglog.app;

import android.Manifest;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/** JavaScript bridge for the rest timer (see RestTimerCore for the notification itself). */
@CapacitorPlugin(
    name = "RestTimer",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class RestTimerPlugin extends Plugin {

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(status());
        } else {
            requestPermissionForAlias("notifications", call, "permissionDone");
        }
    }

    @PermissionCallback
    private void permissionDone(PluginCall call) {
        call.resolve(status());
    }

    private JSObject status() {
        JSObject r = new JSObject();
        r.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        return r;
    }

    @PluginMethod
    public void start(PluginCall call) {
        // JSON numbers arrive as Integer, Long or Double depending on size; getDouble() ignores Longs
        Object endRaw = call.getData().opt("endAt");
        if (!(endRaw instanceof Number)) { call.reject("endAt is required"); return; }
        long endAt = ((Number) endRaw).longValue();
        String title = call.getString("title", "Resting");
        String body = call.getString("body", "Time for your next set");
        boolean sound = Boolean.TRUE.equals(call.getBoolean("sound", true));
        RestTimerCore.saveState(getContext(), endAt, title, body, sound, "app");
        boolean exact = RestTimerCore.start(getContext(), endAt, title, body, sound);
        JSObject r = status();
        r.put("exact", exact);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        RestTimerCore.cancel(getContext());
        SharedPreferences p = RestTimerCore.prefs(getContext());
        RestTimerCore.saveState(getContext(), 0, p.getString("title", "Resting"), p.getString("body", ""), p.getBoolean("sound", true), "app");
        call.resolve();
    }

    /** Current rest as the phone sees it, so the app can apply −15/+15/Skip pressed on the notification. */
    @PluginMethod
    public void getState(PluginCall call) {
        SharedPreferences p = RestTimerCore.prefs(getContext());
        JSObject r = new JSObject();
        // Decimal values: avoids the Long/Double ambiguity on the JS side too
        r.put("endAt", (double) p.getLong("endAt", 0));
        r.put("changedAt", (double) p.getLong("changedAt", 0));
        r.put("source", p.getString("source", ""));
        call.resolve(r);
    }
}
