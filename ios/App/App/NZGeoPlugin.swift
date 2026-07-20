import Foundation
import Capacitor
import CoreLocation
import UserNotifications

/*
 * NZGeo – Einkaufs-Orte mit Geofencing.
 * Die App speichert Orte (Name, Koordinaten, Radius). iOS überwacht die Kreise
 * stromsparend selbst; beim Betreten liest das Plugin die von der App hinterlegte
 * "offene Einkäufe"-Zusammenfassung und zeigt sofort eine lokale Benachrichtigung –
 * komplett ohne App-Start, ohne Server, Standort bleibt auf dem Gerät.
 */
@objc(NZGeoPlugin)
public class NZGeoPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "NZGeoPlugin"
    public let jsName = "NZGeo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlaces", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSummary", returnType: CAPPluginReturnPromise)
    ]

    private var lm: CLLocationManager!
    private var posCall: CAPPluginCall?

    public override func load() {
        lm = CLLocationManager()
        lm.delegate = self
    }

    private func statusString() -> String {
        let s = lm.authorizationStatus
        switch s {
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        case .denied, .restricted: return "denied"
        default: return "prompt"
        }
    }

    @objc func authStatus(_ call: CAPPluginCall) {
        call.resolve(["status": statusString()])
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.lm.authorizationStatus == .notDetermined {
                self.lm.requestWhenInUseAuthorization()
            } else if self.lm.authorizationStatus == .authorizedWhenInUse {
                self.lm.requestAlwaysAuthorization()
            }
            call.resolve(["status": self.statusString()])
        }
    }

    // Einmalige Position (zum Speichern eines Ortes).
    @objc func currentPosition(_ call: CAPPluginCall) {
        posCall = call
        DispatchQueue.main.async {
            if self.lm.authorizationStatus == .notDetermined {
                self.lm.requestWhenInUseAuthorization() // Antwort kommt in didChangeAuthorization
            } else {
                self.lm.requestLocation()
            }
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if posCall != nil, manager.authorizationStatus == .authorizedWhenInUse || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last, let call = posCall else { return }
        posCall = nil
        call.resolve(["lat": loc.coordinate.latitude, "lng": loc.coordinate.longitude])
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if let call = posCall {
            posCall = nil
            call.reject("Standort nicht verfügbar: " + error.localizedDescription)
        }
    }

    // Orte setzen: ersetzt alle überwachten Regionen.
    @objc func setPlaces(_ call: CAPPluginCall) {
        let places = call.getArray("places") as? [[String: Any]] ?? []
        var names: [String: String] = [:]
        DispatchQueue.main.async {
            for r in self.lm.monitoredRegions where r.identifier.hasPrefix("nzp_") {
                self.lm.stopMonitoring(for: r)
            }
            for p in places {
                guard let id = p["id"] as? String,
                      let lat = p["lat"] as? Double,
                      let lng = p["lng"] as? Double else { continue }
                let name = (p["name"] as? String) ?? "Einkauf"
                let radius = min(max((p["radius"] as? Double) ?? 150, 100), 2000)
                let region = CLCircularRegion(
                    center: CLLocationCoordinate2D(latitude: lat, longitude: lng),
                    radius: radius,
                    identifier: "nzp_" + id
                )
                region.notifyOnEntry = true
                region.notifyOnExit = false
                names["nzp_" + id] = name
                self.lm.startMonitoring(for: region)
            }
            UserDefaults.standard.set(names, forKey: "nz_geo_names")
            call.resolve(["ok": true, "count": places.count])
        }
    }

    // Von der App gepflegte Zusammenfassung ("6 Punkte offen auf „Einkauf"").
    // map = { placeId: {count, body} } für Ort-spezifische Punkte (haben Vorrang).
    @objc func setSummary(_ call: CAPPluginCall) {
        UserDefaults.standard.set(call.getInt("count") ?? 0, forKey: "nz_geo_count")
        UserDefaults.standard.set(call.getString("body") ?? "", forKey: "nz_geo_body")
        if let map = call.getObject("map") {
            UserDefaults.standard.set(map, forKey: "nz_geo_map")
        } else {
            UserDefaults.standard.removeObject(forKey: "nz_geo_map")
        }
        call.resolve(["ok": true])
    }

    // Ort betreten → wenn Einkäufe offen sind: sofortige lokale Benachrichtigung.
    public func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        let ud = UserDefaults.standard
        // Ort-spezifische Zusammenfassung hat Vorrang vor der allgemeinen.
        let placeId = region.identifier.replacingOccurrences(of: "nzp_", with: "")
        var count = ud.integer(forKey: "nz_geo_count")
        var body = ud.string(forKey: "nz_geo_body") ?? ""
        if let map = ud.dictionary(forKey: "nz_geo_map"),
           let entry = map[placeId] as? [String: Any] {
            if let c = entry["count"] as? Int { count = c }
            if let b = entry["body"] as? String { body = b }
        }
        guard count > 0 else { return }
        // Drossel: pro Ort höchstens alle 2 Stunden (wichtig, wenn man daneben wohnt).
        let key = "nz_geo_last_" + region.identifier
        let last = ud.double(forKey: key)
        let now = Date().timeIntervalSince1970
        guard now - last > 2 * 3600 else { return }
        ud.set(now, forKey: key)

        let names = (ud.dictionary(forKey: "nz_geo_names") as? [String: String]) ?? [:]
        let placeName = names[region.identifier] ?? "Einkauf"
        let content = UNMutableNotificationContent()
        content.title = "🛒 " + placeName
        content.body = body
        content.sound = .default
        let req = UNNotificationRequest(identifier: "nzgeo-" + region.identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }
}
