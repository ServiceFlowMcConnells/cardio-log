package ie.traininglog.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/** −15 s / +15 s / Skip from the rest notification. The web app picks the change up when it next looks. */
public class RestActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        SharedPreferences p = RestTimerCore.prefs(ctx);
        long endAt = p.getLong("endAt", 0);
        String title = p.getString("title", "Resting");
        String body = p.getString("body", "");
        boolean sound = p.getBoolean("sound", true);
        if (RestTimerCore.ACTION_SKIP.equals(intent.getAction())) {
            RestTimerCore.cancel(ctx);
            RestTimerCore.saveState(ctx, 0, title, body, sound, "notification");
            return;
        }
        if (RestTimerCore.ACTION_ADJUST.equals(intent.getAction()) && endAt > 0) {
            long now = System.currentTimeMillis();
            long next = Math.max(now + 1_000, endAt + intent.getLongExtra(RestTimerCore.EXTRA_DELTA, 0));
            RestTimerCore.saveState(ctx, next, title, body, sound, "notification");
            RestTimerCore.start(ctx, next, title, body, sound);
        }
    }
}
