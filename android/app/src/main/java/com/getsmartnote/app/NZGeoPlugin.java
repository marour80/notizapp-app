package com.getsmartnote.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import com.google.android.gms.tasks.CancellationTokenSource;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/*
 * NZGeo (Android) – Einkaufs-Orte mit Geofencing. Gegenstück zu ios/App/App/NZGeoPlugin.swift:
 * gleiche Methoden + Rückgabeformen, damit src/core/native.js unverändert funktioniert.
 * Orte werden als Geofences (Play Services) überwacht; beim Betreten zeigt NZGeoReceiver
 * eine lokale Benachrichtigung mit der von der App gepflegten Zusammenfassung –
 * ohne App-Start, ohne Server, Standort bleibt auf dem Gerät.
 */
@CapacitorPlugin(
    name = "NZGeo",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "background", strings = { Manifest.permission.ACCESS_BACKGROUND_LOCATION })
    }
)
public class NZGeoPlugin extends Plugin {

    static final String PREFS = "nzgeo";

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private boolean fineGranted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean bgGranted() {
        if (Build.VERSION.SDK_INT < 29) return true; // vor Android 10 gibt es keine getrennte Hintergrund-Berechtigung
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    // Gleiche Status-Strings wie iOS: always / whenInUse / denied / prompt
    private String statusString() {
        if (fineGranted() && bgGranted()) return "always";
        if (fineGranted()) return "whenInUse";
        return prefs().getBoolean("askedLoc", false) ? "denied" : "prompt";
    }

    @PluginMethod
    public void authStatus(PluginCall call) {
        JSObject r = new JSObject();
        r.put("status", statusString());
        call.resolve(r);
    }

    // Stufenweise wie iOS: erst „während der Nutzung", beim nächsten Aufruf „immer" (Hintergrund).
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (!fineGranted()) {
            requestPermissionForAlias("location", call, "permDone");
        } else if (!bgGranted()) {
            // Android 11+ öffnet dafür die System-Einstellungsseite („Immer erlauben" wählen)
            requestPermissionForAlias("background", call, "permDone");
        } else {
            authStatus(call);
        }
    }

    @PermissionCallback
    private void permDone(PluginCall call) {
        prefs().edit().putBoolean("askedLoc", true).apply();
        authStatus(call);
    }

    // Einmalige Position (zum Speichern eines Ortes).
    @PluginMethod
    public void currentPosition(PluginCall call) {
        if (!fineGranted()) {
            requestPermissionForAlias("location", call, "posPermDone");
            return;
        }
        readPosition(call);
    }

    @PermissionCallback
    private void posPermDone(PluginCall call) {
        prefs().edit().putBoolean("askedLoc", true).apply();
        if (fineGranted()) readPosition(call);
        else call.reject("Standort-Berechtigung abgelehnt");
    }

    @SuppressLint("MissingPermission") // fineGranted() wird vor jedem Aufruf geprüft
    private void readPosition(PluginCall call) {
        FusedLocationProviderClient fused = LocationServices.getFusedLocationProviderClient(getContext());
        CancellationTokenSource cts = new CancellationTokenSource();
        fused.getCurrentLocation(Priority.PRIORITY_BALANCED_POWER_ACCURACY, cts.getToken())
            .addOnSuccessListener(loc -> {
                if (loc != null) {
                    JSObject r = new JSObject();
                    r.put("lat", loc.getLatitude());
                    r.put("lng", loc.getLongitude());
                    call.resolve(r);
                } else {
                    call.reject("Standort nicht verfügbar");
                }
            })
            .addOnFailureListener(e -> call.reject("Standort nicht verfügbar: " + e.getMessage()));
    }

    static PendingIntent geoPendingIntent(Context ctx) {
        Intent i = new Intent(ctx, NZGeoReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE; // Geofencing-Daten müssen rein dürfen
        return PendingIntent.getBroadcast(ctx, 4711, i, flags);
    }

    // Orte setzen: ersetzt alle überwachten Geofences (wie iOS setPlaces).
    @SuppressLint("MissingPermission")
    @PluginMethod
    public void setPlaces(PluginCall call) {
        JSArray placesArr = call.getArray("places");
        List<Geofence> fences = new ArrayList<>();
        JSONObject names = new JSONObject();
        try {
            if (placesArr != null) {
                for (int i = 0; i < placesArr.length(); i++) {
                    JSONObject p = placesArr.getJSONObject(i);
                    String id = p.optString("id", "");
                    if (id.isEmpty() || !p.has("lat") || !p.has("lng")) continue;
                    double lat = p.getDouble("lat");
                    double lng = p.getDouble("lng");
                    float radius = (float) Math.min(Math.max(p.optDouble("radius", 150), 100), 2000);
                    String name = p.optString("name", "Einkauf");
                    names.put("nzp_" + id, name);
                    fences.add(new Geofence.Builder()
                        .setRequestId("nzp_" + id)
                        .setCircularRegion(lat, lng, radius)
                        .setExpirationDuration(Geofence.NEVER_EXPIRE)
                        .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_ENTER)
                        .setNotificationResponsiveness(2 * 60 * 1000) // stromsparend: ~2 Min. Reaktionszeit
                        .build());
                }
            }
        } catch (Exception e) {
            call.reject("Ungültige Orte: " + e.getMessage());
            return;
        }

        prefs().edit().putString("names", names.toString()).apply();

        GeofencingClient gc = LocationServices.getGeofencingClient(getContext());
        PendingIntent pi = geoPendingIntent(getContext());
        gc.removeGeofences(pi); // alte weg (auch wenn die Liste jetzt leer ist)

        if (fences.isEmpty() || !fineGranted()) {
            JSObject r = new JSObject();
            r.put("ok", true);
            r.put("count", 0);
            call.resolve(r);
            return;
        }
        GeofencingRequest req = new GeofencingRequest.Builder()
            .setInitialTrigger(0) // nicht sofort feuern, wenn man beim Speichern schon im Radius steht
            .addGeofences(fences)
            .build();
        final int count = fences.size();
        gc.addGeofences(req, pi)
            .addOnSuccessListener(v -> {
                JSObject r = new JSObject();
                r.put("ok", true);
                r.put("count", count);
                call.resolve(r);
            })
            .addOnFailureListener(e -> call.reject("Geofencing fehlgeschlagen: " + e.getMessage()));
    }

    // Von der App gepflegte Zusammenfassung (wie iOS setSummary; map = Ort-spezifisch, hat Vorrang).
    @PluginMethod
    public void setSummary(PluginCall call) {
        SharedPreferences.Editor ed = prefs().edit();
        Integer count = call.getInt("count");
        ed.putInt("count", count != null ? count : 0);
        String body = call.getString("body");
        ed.putString("body", body != null ? body : "");
        JSObject map = call.getObject("map");
        if (map != null) ed.putString("map", map.toString());
        else ed.remove("map");
        ed.apply();
        JSObject r = new JSObject();
        r.put("ok", true);
        call.resolve(r);
    }
}
