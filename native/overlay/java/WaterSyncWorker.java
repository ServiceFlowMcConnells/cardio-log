package ie.traininglog.app;

import android.content.Context;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.BackoffPolicy;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;

import java.io.IOException;
import java.util.concurrent.TimeUnit;

/**
 * Background sync for the water widget: uploads queued taps (idempotent on client_id), then refetches today's
 * total and settings so drinks logged on the web or another device show up. Runs once after each tap (when
 * there's a network, retrying with exponential backoff) and about every hour.
 */
public class WaterSyncWorker extends Worker {
    private static final String TAG = "KataWater";

    public WaterSyncWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    private static Constraints net() { return new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build(); }

    static void enqueueOnce(Context c) {
        OneTimeWorkRequest r = new OneTimeWorkRequest.Builder(WaterSyncWorker.class)
            .setConstraints(net())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(c).enqueueUniqueWork("kata-water-sync", ExistingWorkPolicy.APPEND_OR_REPLACE, r);
    }
    static void schedulePeriodic(Context c) {
        PeriodicWorkRequest r = new PeriodicWorkRequest.Builder(WaterSyncWorker.class, 60, TimeUnit.MINUTES)
            .setConstraints(net())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 60, TimeUnit.SECONDS)
            .build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("kata-water-refresh", ExistingPeriodicWorkPolicy.KEEP, r);
    }
    static void cancelPeriodic(Context c) { WorkManager.getInstance(c).cancelUniqueWork("kata-water-refresh"); }

    @NonNull
    @Override
    public Result doWork() {
        Context c = getApplicationContext();
        WaterWidget.scheduleMidnight(c);
        if (!WaterStore.signedIn(c)) { WaterWidget.renderAll(c); return Result.success(); }
        try {
            JSONArray q = WaterStore.queue(c);
            if (q.length() > 0) {
                try {
                    WaterApi.insert(c, q);
                } catch (IllegalStateException bad) {
                    // The server refused these rows outright (not a network problem): drop them rather than retry forever
                    Log.w(TAG, "dropping rejected taps", bad);
                }
                WaterStore.markSynced(c, WaterStore.ids(q));
            }
            String day = WaterStore.today();
            Object[] t = WaterApi.fetchToday(c, day);
            WaterStore.setFromServer(c, day, (Integer) t[0], (Integer) t[1], (Integer) t[2]);
            WaterWidget.renderAll(c);
            return Result.success();
        } catch (WaterApi.AuthGone gone) {
            Log.w(TAG, "widget session ended: " + gone.getMessage());
            WaterStore.clearAuth(c); // queued taps stay; the app saves them once you're signed in again
            WaterWidget.renderAll(c);
            return Result.failure();
        } catch (IOException io) {
            Log.w(TAG, "sync failed, will retry: " + io.getMessage());
            WaterWidget.renderAll(c);
            return Result.retry();
        }
    }
}
