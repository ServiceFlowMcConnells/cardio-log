package ie.traininglog.app;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;

import java.util.HashSet;
import java.util.Set;

/** JavaScript bridge for the water widget (see src/lib/widget.ts). */
@CapacitorPlugin(name = "Hydration")
public class HydrationPlugin extends Plugin {

    @Override
    public void load() {
        if (WaterWidget.hasWidgets(getContext())) WaterSyncWorker.schedulePeriodic(getContext());
    }

    private static int num(PluginCall call, String k, int dflt) {
        Object o = call.getData().opt(k);
        return o instanceof Number ? ((Number) o).intValue() : dflt;
    }

    /** The widget's own session (minted by the widget-session function), kept in encrypted storage. */
    @PluginMethod
    public void setSession(PluginCall call) {
        String url = call.getString("url"), key = call.getString("anonKey"), refresh = call.getString("refreshToken"), user = call.getString("userId");
        if (url == null || key == null || refresh == null) { call.reject("url, anonKey and refreshToken are required"); return; }
        WaterStore.saveAuth(getContext(), url, key, refresh, user);
        WaterWidget.renderAll(getContext());
        WaterSyncWorker.enqueueOnce(getContext());
        JSObject r = new JSObject();
        r.put("ok", WaterStore.signedIn(getContext()));
        call.resolve(r);
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        WaterStore.clearAuth(getContext());
        WaterWidget.renderAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void getSession(PluginCall call) {
        JSObject r = new JSObject();
        r.put("signedIn", WaterStore.signedIn(getContext()));
        r.put("userId", WaterStore.userId(getContext()));
        r.put("widgets", WaterWidget.hasWidgets(getContext()));
        call.resolve(r);
    }

    /** Today's total, target and + amount from the app; redraws the widget. */
    @PluginMethod
    public void setState(PluginCall call) {
        String day = call.getString("localDate", WaterStore.today());
        WaterStore.setFromApp(getContext(), num(call, "total", 0), num(call, "target", 3000), num(call, "increment", 250), day);
        WaterWidget.renderAll(getContext());
        JSObject r = new JSObject();
        r.put("shown", WaterStore.displayTotal(getContext()));
        call.resolve(r);
    }

    /** Taps not yet saved. The app inserts them (dedupe on client_id) and then calls ackQueue. */
    @PluginMethod
    public void drainQueue(PluginCall call) { call.resolve(items(WaterStore.queue(getContext()))); }

    @PluginMethod
    public void ackQueue(PluginCall call) {
        JSArray ids = call.getArray("ids");
        Set<String> s = new HashSet<>();
        if (ids != null) for (int i = 0; i < ids.length(); i++) s.add(ids.optString(i));
        WaterStore.markSynced(getContext(), s);
        WaterWidget.renderAll(getContext());
        call.resolve();
    }

    /** Widget taps for the app to write to Health Connect (cleared once taken). */
    @PluginMethod
    public void takeHealthPending(PluginCall call) { call.resolve(items(WaterStore.takeHealthPending(getContext()))); }

    /** "hydration" once after the app was opened from the widget. */
    @PluginMethod
    public void takeLaunchTarget(PluginCall call) {
        JSObject r = new JSObject();
        r.put("target", WaterStore.takeLaunch(getContext()));
        call.resolve(r);
    }

    /** Asks the launcher to add the widget (it shows its own confirmation). */
    @PluginMethod
    public void pinWidget(PluginCall call) {
        AppWidgetManager m = AppWidgetManager.getInstance(getContext());
        boolean ok = m.isRequestPinAppWidgetSupported() && m.requestPinAppWidget(new ComponentName(getContext(), WaterWidget.class), null, null);
        JSObject r = new JSObject();
        r.put("ok", ok);
        call.resolve(r);
    }

    @PluginMethod
    public void syncNow(PluginCall call) {
        WaterSyncWorker.enqueueOnce(getContext());
        call.resolve();
    }

    /** Current widget numbers (for tests and diagnostics). */
    @PluginMethod
    public void getState(PluginCall call) {
        JSObject r = new JSObject();
        r.put("shown", WaterStore.displayTotal(getContext()));
        r.put("target", WaterStore.target(getContext()));
        r.put("increment", WaterStore.increment(getContext()));
        r.put("queued", WaterStore.queue(getContext()).length());
        r.put("signedIn", WaterStore.signedIn(getContext()));
        r.put("widgets", WaterWidget.hasWidgets(getContext()));
        call.resolve(r);
    }

    private static JSObject items(JSONArray a) {
        JSObject r = new JSObject();
        try { r.put("items", new JSArray(a.toString())); } catch (JSONException e) { r.put("items", new JSArray()); }
        return r;
    }
}
