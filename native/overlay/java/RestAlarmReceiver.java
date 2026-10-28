package ie.traininglog.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Fires at the end of a rest: clears the countdown and posts "Rest over" with sound. */
public class RestAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        RestTimerPlugin.ensureChannels(ctx);
        boolean sound = intent.getBooleanExtra("sound", true);
        String body = intent.getStringExtra("body");
        NotificationManagerCompat nm = NotificationManagerCompat.from(ctx);
        nm.cancel(RestTimerPlugin.ID_COUNTDOWN);
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, sound ? RestTimerPlugin.CH_DONE : RestTimerPlugin.CH_DONE_QUIET)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle("Rest over")
            .setContentText(body != null && !body.isEmpty() ? body : "Time for your next set")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVibrate(RestTimerPlugin.VIBRATE)
            .setAutoCancel(true)
            .setTimeoutAfter(60_000)
            .setColor(0xFFED202F)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(RestTimerPlugin.openApp(ctx));
        if (sound) b.setDefaults(NotificationCompat.DEFAULT_SOUND);
        try { nm.notify(RestTimerPlugin.ID_DONE, b.build()); } catch (SecurityException ignored) { /* notifications not allowed */ }
    }
}
