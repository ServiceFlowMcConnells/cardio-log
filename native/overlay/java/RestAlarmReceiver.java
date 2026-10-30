package ie.traininglog.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;

/** Fires at the end of a rest: swaps the countdown for "Rest over" with sound. */
public class RestAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        RestTimerCore.showDone(ctx);
        SharedPreferences p = RestTimerCore.prefs(ctx);
        RestTimerCore.saveState(ctx, 0, p.getString("title", "Resting"), p.getString("body", ""), p.getBoolean("sound", true), "alarm");
    }
}
