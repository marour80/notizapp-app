package com.getsmartnote.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

import org.json.JSONObject;

import java.util.List;

/*
 * Empfängt Geofence-Übergänge (auch bei geschlossener App) und zeigt die
 * "🛒 <Ort> – N Punkte offen"-Benachrichtigung. Spiegelbild von didEnterRegion
 * im iOS-NZGeoPlugin inkl. 2-Stunden-Drossel pro Ort.
 */
public class NZGeoReceiver extends BroadcastReceiver {

    private static final String CHANNEL = "nzgeo";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        GeofencingEvent ev = GeofencingEvent.fromIntent(intent);
        if (ev == null || ev.hasError()) return;
        if (ev.getGeofenceTransition() != Geofence.GEOFENCE_TRANSITION_ENTER) return;
        List<Geofence> hits = ev.getTriggeringGeofences();
        if (hits == null) return;
        for (Geofence g : hits) handleEnter(ctx, g.getRequestId());
    }

    private void handleEnter(Context ctx, String requestId) {
        SharedPreferences ud = ctx.getSharedPreferences(NZGeoPlugin.PREFS, Context.MODE_PRIVATE);

        // Ort-spezifische Zusammenfassung hat Vorrang vor der allgemeinen.
        String placeId = requestId.replace("nzp_", "");
        int count = ud.getInt("count", 0);
        String body = ud.getString("body", "");
        try {
            String mapRaw = ud.getString("map", null);
            if (mapRaw != null) {
                JSONObject entry = new JSONObject(mapRaw).optJSONObject(placeId);
                if (entry != null) {
                    count = entry.optInt("count", count);
                    body = entry.optString("body", body);
                }
            }
        } catch (Exception ignored) {}
        if (count <= 0) return;

        // Drossel: pro Ort höchstens alle 2 Stunden (wichtig, wenn man daneben wohnt).
        String key = "last_" + requestId;
        long now = System.currentTimeMillis();
        if (now - ud.getLong(key, 0) < 2L * 3600 * 1000) return;
        ud.edit().putLong(key, now).apply();

        String placeName = "Einkauf";
        try {
            String namesRaw = ud.getString("names", null);
            if (namesRaw != null) placeName = new JSONObject(namesRaw).optString(requestId, placeName);
        } catch (Exception ignored) {}

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Einkaufs-Orte", NotificationManager.IMPORTANCE_HIGH));
        }

        Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(
            ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(ctx.getApplicationInfo().icon)
            .setContentTitle("🛒 " + placeName) // 🛒
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_HIGH);
        if (tap != null) b.setContentIntent(tap);
        nm.notify(requestId.hashCode(), b.build());
    }
}
