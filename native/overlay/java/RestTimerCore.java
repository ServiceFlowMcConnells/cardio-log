package ie.traininglog.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/**
 * The rest timer's notification, alarm and state, shared by the plugin and the receivers.
 *
 * The live notification is styled like the Clock app's stopwatch: big countdown digits, the next set,
 * and −15 s / +15 s / Skip buttons. It uses a normal-importance channel with no sound, so it sits with
 * the other ongoing notifications at the top of the shade and shows on the lock screen (Android hides
 * "silent" notifications there by default).
 */
public final class RestTimerCore {
    private RestTimerCore() {}

    static final String CH_LIVE = "rest_live";
    static final String CH_DONE = "rest_done";
    static final String CH_DONE_QUIET = "rest_done_quiet";
    static final int ID_COUNTDOWN = 1001;
    static final int ID_DONE = 1002;
    static final long[] VIBRATE = { 0, 300, 150, 300, 150, 500 };

    static final String ACTION_ADJUST = "ie.traininglog.app.REST_ADJUST";
    static final String ACTION_SKIP = "ie.traininglog.app.REST_SKIP";
    static final String EXTRA_DELTA = "delta";

    private static final String PREFS = "rest_timer";

    // ---------- State (so the web app can pick up changes made from the notification) ----------

    static SharedPreferences prefs(Context ctx) { return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    static void saveState(Context ctx, long endAt, String title, String body, boolean sound, String source) {
        prefs(ctx).edit()
            .putLong("endAt", endAt)
            .putString("title", title)
            .putString("body", body)
            .putBoolean("sound", sound)
            .putString("source", source)
            .putLong("changedAt", System.currentTimeMillis())
            .apply();
    }

    // ---------- Channels ----------

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        // Old low-importance countdown channel from v1.0.0–1.0.3: replaced by rest_live
        nm.deleteNotificationChannel("rest_countdown");

        NotificationChannel live = new NotificationChannel(CH_LIVE, "Rest timer", NotificationManager.IMPORTANCE_DEFAULT);
        live.setDescription("Live countdown while you rest, on the lock screen too. No sound.");
        live.setSound(null, null);
        live.enableVibration(false);
        live.setShowBadge(false);
        live.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(live);

        NotificationChannel done = new NotificationChannel(CH_DONE, "Rest over", NotificationManager.IMPORTANCE_HIGH);
        done.setDescription("Sound and vibration when your rest ends");
        AudioAttributes aa = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        done.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), aa);
        done.enableVibration(true);
        done.setVibrationPattern(VIBRATE);
        done.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(done);

        NotificationChannel quiet = new NotificationChannel(CH_DONE_QUIET, "Rest over (vibrate only)", NotificationManager.IMPORTANCE_HIGH);
        quiet.setDescription("Vibration only when your rest ends");
        quiet.setSound(null, null);
        quiet.enableVibration(true);
        quiet.setVibrationPattern(VIBRATE);
        quiet.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(quiet);
    }

    // ---------- Intents ----------

    static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static PendingIntent alarmIntent(Context ctx) {
        Intent i = new Intent(ctx, RestAlarmReceiver.class);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static PendingIntent action(Context ctx, String action, long delta, int requestCode) {
        Intent i = new Intent(ctx, RestActionReceiver.class).setAction(action).putExtra(EXTRA_DELTA, delta);
        return PendingIntent.getBroadcast(ctx, requestCode, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    // ---------- Show / cancel ----------

    /** Shows (or updates) the live countdown and sets the alarm for its end. Returns whether the alarm is exact. */
    static boolean start(Context ctx, long endAt, String title, String body, boolean sound) {
        ensureChannels(ctx);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(ID_DONE);

        long base = SystemClock.elapsedRealtime() + (endAt - System.currentTimeMillis());
        RemoteViews small = new RemoteViews(ctx.getPackageName(), R.layout.notif_rest_small);
        RemoteViews big = new RemoteViews(ctx.getPackageName(), R.layout.notif_rest_big);
        for (RemoteViews v : new RemoteViews[] { small, big }) {
            v.setTextViewText(R.id.rest_title, title);
            v.setTextViewText(R.id.rest_body, body);
            v.setViewVisibility(R.id.rest_body, body == null || body.isEmpty() ? View.GONE : View.VISIBLE);
            v.setChronometer(R.id.rest_clock, base, null, true);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) v.setChronometerCountDown(R.id.rest_clock, true);
        }
        big.setOnClickPendingIntent(R.id.rest_minus, action(ctx, ACTION_ADJUST, -15_000, 1));
        big.setOnClickPendingIntent(R.id.rest_plus, action(ctx, ACTION_ADJUST, 15_000, 2));
        big.setOnClickPendingIntent(R.id.rest_skip, action(ctx, ACTION_SKIP, 0, 3));

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH_LIVE)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(title)
            .setContentText(body)
            .setCustomContentView(small)
            .setCustomBigContentView(big)
            .setCustomHeadsUpContentView(small)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            // The big countdown is in the layout; keep the header to just the app name, like the Clock app
            .setShowWhen(false)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(0xFFED202F)
            .setContentIntent(openApp(ctx));
        try { nm.notify(ID_COUNTDOWN, b.build()); } catch (SecurityException ignored) { /* notifications not allowed */ }

        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) am.setExact(AlarmManager.RTC_WAKEUP, endAt, pi);
        else if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);
        return exact;
    }

    static void cancel(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmIntent(ctx));
        NotificationManagerCompat.from(ctx).cancel(ID_COUNTDOWN);
    }

    /** The "Rest over" alert, with sound unless the user turned it off. */
    static void showDone(Context ctx) {
        ensureChannels(ctx);
        SharedPreferences p = prefs(ctx);
        boolean sound = p.getBoolean("sound", true);
        String body = p.getString("body", "");
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(ID_COUNTDOWN);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, sound ? CH_DONE : CH_DONE_QUIET)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle("Rest over")
            .setContentText(body != null && !body.isEmpty() ? body : "Time for your next set")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(VIBRATE)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .setColor(0xFFED202F)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp(ctx));
        if (sound) b.setDefaults(NotificationCompat.DEFAULT_SOUND);
        try { nm.notify(ID_DONE, b.build()); } catch (SecurityException ignored) { /* notifications not allowed */ }
    }
}
