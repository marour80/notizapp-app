package com.getsmartnote.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NZGeoPlugin.class); // Einkaufs-Orte (Geofencing) – Gegenstück zum iOS-NZGeoPlugin
        super.onCreate(savedInstanceState);
    }
}
