package ie.traininglog.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKeys;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

/**
 * Hydration widget state on the phone.
 *  - kata_water (plain): today's cached total from the server ("base"), target, + amount, the local date the
 *    cache is for, the queue of taps not yet saved, taps waiting for Health Connect, and a deep-link target.
 *  - kata_water_auth (EncryptedSharedPreferences): Supabase URL, publishable key and the widget's own session.
 * What the widget shows = base (if it's for today) + queued taps from today.
 */
final class WaterStore {
    private static final String TAG = "KataWater";
    static final Object LOCK = new Object();
    private static SharedPreferences authPrefs;

    private WaterStore() {}

    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences("kata_water", Context.MODE_PRIVATE); }

    /** Encrypted store for the session; null if the keystore isn't usable (then the widget acts signed out). */
    static synchronized SharedPreferences auth(Context c) {
        if (authPrefs != null) return authPrefs;
        try {
            String key = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC);
            authPrefs = EncryptedSharedPreferences.create("kata_water_auth", key, c.getApplicationContext(),
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM);
        } catch (Exception e) {
            Log.w(TAG, "encrypted prefs unavailable", e);
            authPrefs = null;
        }
        return authPrefs;
    }

    static String today() { return LocalDate.now().toString(); }

    // ---------- session ----------
    static void saveAuth(Context c, String url, String key, String refresh, String userId) {
        SharedPreferences a = auth(c);
        if (a == null) return;
        a.edit().putString("url", url).putString("key", key).putString("refresh", refresh).putString("user", userId)
            .remove("access").remove("exp").commit();
    }
    static void clearAuth(Context c) {
        SharedPreferences a = auth(c);
        if (a != null) a.edit().clear().commit();
    }
    static boolean signedIn(Context c) {
        SharedPreferences a = auth(c);
        return a != null && a.getString("refresh", null) != null && a.getString("url", null) != null;
    }
    static String userId(Context c) { SharedPreferences a = auth(c); return a == null ? null : a.getString("user", null); }

    // ---------- totals ----------
    /** Moves the cache to today if the date has rolled over (new day starts at 0). */
    private static void roll(SharedPreferences p) {
        String t = today();
        if (!t.equals(p.getString("date", ""))) p.edit().putString("date", t).putInt("base", 0).commit();
    }
    static int displayTotal(Context c) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(c);
            roll(p);
            int sum = p.getInt("base", 0);
            JSONArray q = array(p, "queue");
            String t = today();
            for (int i = 0; i < q.length(); i++) {
                JSONObject o = q.optJSONObject(i);
                if (o != null && t.equals(o.optString("local_date"))) sum += o.optInt("ml");
            }
            return sum;
        }
    }
    static int target(Context c) { return Math.max(250, prefs(c).getInt("target", 3000)); }
    static int increment(Context c) { return Math.max(10, prefs(c).getInt("increment", 250)); }

    /** From the app: its total for `localDate`, and the settings. */
    static void setFromApp(Context c, int total, int target, int increment, String localDate) {
        synchronized (LOCK) {
            SharedPreferences.Editor e = prefs(c).edit().putInt("target", target).putInt("increment", increment);
            if (today().equals(localDate)) e.putString("date", localDate).putInt("base", total);
            e.commit();
        }
    }
    /** From the server (the widget's own refresh): today's saved total and the settings. */
    static void setFromServer(Context c, String day, int total, Integer target, Integer increment) {
        synchronized (LOCK) {
            SharedPreferences.Editor e = prefs(c).edit();
            if (target != null) e.putInt("target", target);
            if (increment != null) e.putInt("increment", increment);
            if (today().equals(day)) e.putString("date", day).putInt("base", total);
            e.commit();
        }
    }

    // ---------- queue ----------
    /** A tap on +: queued for upload and for Health Connect, counted straight away. */
    static JSONObject addTap(Context c) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(c);
            roll(p);
            JSONObject o = new JSONObject();
            try {
                o.put("client_id", UUID.randomUUID().toString());
                o.put("ml", increment(c));
                o.put("logged_at", Instant.now().toString());
                o.put("local_date", today());
            } catch (JSONException ignored) {}
            JSONArray q = array(p, "queue"); q.put(o);
            JSONArray h = array(p, "hc"); h.put(o);
            while (h.length() > 200) h.remove(0);
            p.edit().putString("queue", q.toString()).putString("hc", h.toString()).commit();
            return o;
        }
    }
    static JSONArray queue(Context c) { synchronized (LOCK) { return array(prefs(c), "queue"); } }

    /** Saved on the server (by the widget or the app): out of the queue and into the cached total. */
    static void markSynced(Context c, Set<String> ids) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(c);
            roll(p);
            String day = p.getString("date", today());
            int base = p.getInt("base", 0);
            JSONArray q = array(p, "queue"), keep = new JSONArray();
            for (int i = 0; i < q.length(); i++) {
                JSONObject o = q.optJSONObject(i);
                if (o == null) continue;
                if (ids.contains(o.optString("client_id"))) { if (day.equals(o.optString("local_date"))) base += o.optInt("ml"); }
                else keep.put(o);
            }
            p.edit().putString("queue", keep.toString()).putInt("base", base).commit();
        }
    }
    static Set<String> ids(JSONArray a) {
        Set<String> s = new HashSet<>();
        for (int i = 0; i < a.length(); i++) { JSONObject o = a.optJSONObject(i); if (o != null) s.add(o.optString("client_id")); }
        return s;
    }

    static JSONArray takeHealthPending(Context c) {
        synchronized (LOCK) {
            SharedPreferences p = prefs(c);
            JSONArray h = array(p, "hc");
            p.edit().remove("hc").commit();
            return h;
        }
    }

    static void setLaunch(Context c, String target) { prefs(c).edit().putString("launch", target).commit(); }
    static String takeLaunch(Context c) {
        SharedPreferences p = prefs(c);
        String t = p.getString("launch", null);
        if (t != null) p.edit().remove("launch").commit();
        return t;
    }

    static JSONArray array(SharedPreferences p, String k) {
        try { return new JSONArray(p.getString(k, "[]")); } catch (JSONException e) { return new JSONArray(); }
    }

    /** "1.75" / "3.0": two decimals, one when the second is a zero (same as the app). */
    static String litres(int ml) {
        String two = String.format(Locale.US, "%.2f", ml / 1000.0);
        return two.endsWith("0") ? String.format(Locale.US, "%.1f", ml / 1000.0) : two;
    }
}
