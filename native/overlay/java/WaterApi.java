package ie.traininglog.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Supabase calls for the widget's background sync, using the widget's own session (see widget-session). */
final class WaterApi {
    private WaterApi() {}

    /** The session is gone for good (revoked or expired): the widget shows "Open Kata to sign in". */
    static final class AuthGone extends Exception { AuthGone(String m) { super(m); } }

    private static final Object REFRESH_LOCK = new Object();

    private static final class Resp { final int code; final String body; Resp(int c, String b) { code = c; body = b; } }

    private static Resp http(String method, String url, String key, String bearer, String body, String prefer) throws IOException {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(15000);
        h.setReadTimeout(20000);
        h.setRequestMethod(method);
        h.setRequestProperty("apikey", key);
        h.setRequestProperty("Accept", "application/json");
        if (bearer != null) h.setRequestProperty("Authorization", "Bearer " + bearer);
        if (prefer != null) h.setRequestProperty("Prefer", prefer);
        if (body != null) {
            h.setDoOutput(true);
            h.setRequestProperty("Content-Type", "application/json");
            try (OutputStream o = h.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = h.getResponseCode();
        InputStream in = code >= 400 ? h.getErrorStream() : h.getInputStream();
        String text = "";
        if (in != null) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            in.close();
            text = b.toString("UTF-8");
        }
        h.disconnect();
        return new Resp(code, text);
    }

    /** A valid access token, refreshing (and saving the rotated refresh token) when needed. */
    static String accessToken(Context c, boolean force) throws IOException, AuthGone {
        synchronized (REFRESH_LOCK) {
            SharedPreferences a = WaterStore.auth(c);
            if (a == null || a.getString("refresh", null) == null) throw new AuthGone("no session");
            String access = a.getString("access", null);
            long exp = a.getLong("exp", 0);
            if (!force && access != null && exp - 60_000 > System.currentTimeMillis()) return access;
            JSONObject body = new JSONObject();
            try { body.put("refresh_token", a.getString("refresh", "")); } catch (JSONException ignored) {}
            Resp r = http("POST", a.getString("url", "") + "/auth/v1/token?grant_type=refresh_token", a.getString("key", ""), null, body.toString(), null);
            if (r.code == 400 || r.code == 401 || r.code == 403) throw new AuthGone("refresh refused: " + r.code + " " + r.body);
            if (r.code >= 300) throw new IOException("refresh failed: " + r.code);
            try {
                JSONObject j = new JSONObject(r.body);
                String acc = j.getString("access_token");
                a.edit().putString("access", acc).putString("refresh", j.getString("refresh_token"))
                    .putLong("exp", System.currentTimeMillis() + j.optLong("expires_in", 3600) * 1000L).commit();
                return acc;
            } catch (JSONException e) {
                throw new IOException("bad refresh response");
            }
        }
    }

    private static Resp authed(Context c, String method, String path, String body, String prefer) throws IOException, AuthGone {
        SharedPreferences a = WaterStore.auth(c);
        if (a == null) throw new AuthGone("no store");
        String url = a.getString("url", "") + path, key = a.getString("key", "");
        Resp r = http(method, url, key, accessToken(c, false), body, prefer);
        if (r.code == 401) r = http(method, url, key, accessToken(c, true), body, prefer);
        if (r.code == 401) throw new AuthGone("unauthorised");
        return r;
    }

    /** Inserts queued taps; rows whose client_id is already saved are skipped (so retries never duplicate). */
    static void insert(Context c, JSONArray queue) throws IOException, AuthGone {
        JSONArray rows = new JSONArray();
        for (int i = 0; i < queue.length(); i++) {
            JSONObject q = queue.optJSONObject(i);
            if (q == null) continue;
            JSONObject o = new JSONObject();
            try {
                o.put("client_id", q.getString("client_id"));
                o.put("ml", q.getInt("ml"));
                o.put("logged_at", q.getString("logged_at"));
                o.put("local_date", q.getString("local_date"));
                o.put("source", "widget");
            } catch (JSONException e) { continue; }
            rows.put(o);
        }
        if (rows.length() == 0) return;
        Resp r = authed(c, "POST", "/rest/v1/water_log?on_conflict=client_id", rows.toString(), "resolution=ignore-duplicates,return=minimal");
        if (r.code >= 500) throw new IOException("insert failed: " + r.code);
        if (r.code >= 300) throw new IllegalStateException("insert rejected: " + r.code + " " + r.body);
    }

    /** Today's saved total, and the target and + amount from settings (null when not set). */
    static Object[] fetchToday(Context c, String day) throws IOException, AuthGone {
        Resp r = authed(c, "GET", "/rest/v1/water_log?select=ml&local_date=eq." + day, null, null);
        if (r.code >= 300) throw new IOException("fetch failed: " + r.code);
        int total = 0;
        try {
            JSONArray a = new JSONArray(r.body);
            for (int i = 0; i < a.length(); i++) total += a.getJSONObject(i).optInt("ml");
        } catch (JSONException e) { throw new IOException("bad fetch response"); }
        Integer target = null, inc = null;
        Resp s = authed(c, "GET", "/rest/v1/user_settings?select=water_target_ml,water_increment_ml", null, null);
        if (s.code < 300) {
            try {
                JSONArray a = new JSONArray(s.body);
                if (a.length() > 0) {
                    JSONObject o = a.getJSONObject(0);
                    if (!o.isNull("water_target_ml")) target = o.getInt("water_target_ml");
                    if (!o.isNull("water_increment_ml")) inc = o.getInt("water_increment_ml");
                }
            } catch (JSONException ignored) {}
        }
        return new Object[] { total, target, inc };
    }
}
