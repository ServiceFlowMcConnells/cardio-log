package ie.traininglog.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import java.time.LocalDate;
import java.time.ZoneId;

/** Home-screen water widget (4×1): droplet | "1.75 / 3.0 L" over a thin bar | "+250 ml". */
public class WaterWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context c, AppWidgetManager m, int[] ids) {
        for (int id : ids) m.updateAppWidget(id, build(c));
        scheduleMidnight(c);
    }

    @Override
    public void onEnabled(Context c) {
        WaterSyncWorker.schedulePeriodic(c);
        WaterSyncWorker.enqueueOnce(c);
        scheduleMidnight(c);
    }

    @Override
    public void onDisabled(Context c) {
        WaterSyncWorker.cancelPeriodic(c);
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(midnightIntent(c));
    }

    static boolean hasWidgets(Context c) {
        return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c, WaterWidget.class)).length > 0;
    }

    static void renderAll(Context c) {
        AppWidgetManager m = AppWidgetManager.getInstance(c);
        int[] ids = m.getAppWidgetIds(new ComponentName(c, WaterWidget.class));
        if (ids.length == 0) return;
        RemoteViews v = build(c);
        for (int id : ids) m.updateAppWidget(id, v);
    }

    static PendingIntent openApp(Context c) {
        Intent i = new Intent(c, MainActivity.class);
        i.putExtra("kata_open", "hydration");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(c, 41, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static RemoteViews build(Context c) {
        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.widget_water);
        PendingIntent open = openApp(c);
        v.setOnClickPendingIntent(R.id.water_root, open);
        if (!WaterStore.signedIn(c)) {
            v.setTextViewText(R.id.water_text, "Open Kata to sign in");
            v.setViewVisibility(R.id.water_bar, View.GONE);
            v.setViewVisibility(R.id.water_bar_done, View.GONE);
            v.setTextViewText(R.id.water_plus, "Open");
            v.setOnClickPendingIntent(R.id.water_plus, open);
            return v;
        }
        int total = WaterStore.displayTotal(c), target = WaterStore.target(c), inc = WaterStore.increment(c);
        int pct = (int) Math.min(100, Math.round(total * 100.0 / target));
        boolean done = total >= target;
        v.setTextViewText(R.id.water_text, WaterStore.litres(total) + " / " + WaterStore.litres(target) + " L");
        v.setViewVisibility(R.id.water_bar, done ? View.GONE : View.VISIBLE);
        v.setViewVisibility(R.id.water_bar_done, done ? View.VISIBLE : View.GONE);
        v.setProgressBar(R.id.water_bar, 100, pct, false);
        v.setProgressBar(R.id.water_bar_done, 100, 100, false);
        v.setTextViewText(R.id.water_plus, "+" + inc + " ml");
        v.setContentDescription(R.id.water_plus, "Add " + inc + " millilitres of water");
        Intent add = new Intent(c, WaterReceiver.class).setAction(WaterReceiver.ACTION_ADD);
        v.setOnClickPendingIntent(R.id.water_plus, PendingIntent.getBroadcast(c, 42, add, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        return v;
    }

    private static PendingIntent midnightIntent(Context c) {
        Intent i = new Intent(c, WaterReceiver.class).setAction(WaterReceiver.ACTION_MIDNIGHT);
        return PendingIntent.getBroadcast(c, 43, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    /** An inexact alarm just after local midnight, so the widget resets to 0 for the new day. */
    static void scheduleMidnight(Context c) {
        if (!hasWidgets(c)) return;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = LocalDate.now().plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli() + 60_000;
        am.set(AlarmManager.RTC, at, midnightIntent(c));
    }
}
