package ie.traininglog.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Widget actions: "+" (queue the drink, redraw at once, sync in the background) and the midnight redraw. */
public class WaterReceiver extends BroadcastReceiver {
    static final String ACTION_ADD = "ie.traininglog.app.WATER_ADD";
    static final String ACTION_MIDNIGHT = "ie.traininglog.app.WATER_MIDNIGHT";

    @Override
    public void onReceive(Context c, Intent intent) {
        String a = intent.getAction();
        if (ACTION_ADD.equals(a)) {
            if (!WaterStore.signedIn(c)) {
                try { WaterWidget.openApp(c).send(); } catch (PendingIntent.CanceledException ignored) {}
                return;
            }
            WaterStore.addTap(c);
            WaterWidget.renderAll(c);
            WaterSyncWorker.enqueueOnce(c);
        } else if (ACTION_MIDNIGHT.equals(a)) {
            WaterWidget.renderAll(c);
            WaterWidget.scheduleMidnight(c);
            WaterSyncWorker.enqueueOnce(c);
        }
    }
}
