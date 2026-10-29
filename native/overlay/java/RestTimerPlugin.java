package ie.traininglog.app;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Rest timer for Training Log.
 * start(): shows an ongoing notification with a live countdown (Android's chronometer) and sets an
 * exact alarm for the end of the rest. At the end, RestAlarmReceiver swaps it for a "Rest over"
 * notification with sound and vibration, even if the app is minimised or the screen is off.
 */
@CapacitorPlugin(
    name = "RestTimer",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class RestTimerPlugin extends Plugin {
    static final String CH_COUNTDOWN = "rest_countdown";
    static final String CH_DONE = "rest_done";
    static final String CH_DONE_QUIET = "rest_done_quiet";
    static final int ID_COUNTDOWN = 1001;
    static final int ID_DONE = 1002;
    static final long[] VIBRATE = { 0, 300, 150, 300, 150, 500 };

    static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel countdown = new NotificationChannel(CH_COUNTDOWN, "Rest countdown", NotificationManager.IMPORTANCE_LOW);
        countdown.setDescription("Live countdown while you rest");
        countdown.setSound(null, null);
        countdown.enableVibration(false);
        countdown.setShowBadge(false);
        nm.createNotificationChannel(countdown);

        NotificationChannel done = new NotificationChannel(CH_DONE, "Rest over", NotificationManager.IMPORTANCE_HIGH);
        done.setDescription("Sound and vibration when your rest ends");
        AudioAttributes aa = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        done.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), aa);
        done.enableVibration(true);
        done.setVibrationPattern(VIBRATE);
        nm.createNotificationChannel(done);

        NotificationChannel quiet = new NotificationChannel(CH_DONE_QUIET, "Rest over (vibrate only)", NotificationManager.IMPORTANCE_HIGH);
        quiet.setDescription("Vibration only when your rest ends");
        quiet.setSound(null, null);
        quiet.enableVibration(true);
        quiet.setVibrationPattern(VIBRATE);
        nm.createNotificationChannel(quiet);
    }

    static PendingIntent openApp(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private PendingIntent alarmIntent(Context ctx, String body, boolean sound) {
        Intent i = new Intent(ctx, RestAlarmReceiver.class);
        i.putExtra("body", body);
        i.putExtra("sound", sound);
        return PendingIntent.getBroadcast(ctx, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

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
        Context ctx = getContext();
        // JSON numbers arrive as Integer, Long or Double depending on size; getDouble() ignores Longs
        Object endRaw = call.getData().opt("endAt");
        if (!(endRaw instanceof Number)) { call.reject("endAt is required"); return; }
        long endAt = ((Number) endRaw).longValue();
        String title = call.getString("title", "Resting");
        String body = call.getString("body", "Time for your next set");
        boolean sound = Boolean.TRUE.equals(call.getBoolean("sound", true));
        ensureChannels(ctx);

        // Live countdown
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CH_COUNTDOWN)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(title)
            .setContentText(body)
            .setWhen(endAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(0xFFED202F)
            .setContentIntent(openApp(ctx));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) b.setChronometerCountDown(true);
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(ID_DONE);
        try { nm.notify(ID_COUNTDOWN, b.build()); } catch (SecurityException ignored) { /* notifications not allowed */ }

        // Alarm for the end
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, body, sound);
        boolean exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) am.setExact(AlarmManager.RTC_WAKEUP, endAt, pi);
        else if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, endAt, pi);

        JSObject r = status();
        r.put("exact", exact);
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Context ctx = getContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        am.cancel(alarmIntent(ctx, "", true));
        NotificationManagerCompat.from(ctx).cancel(ID_COUNTDOWN);
        call.resolve();
    }
}
