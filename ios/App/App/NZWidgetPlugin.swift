import Foundation
import Capacitor
import WidgetKit

/*
 * NZWidget – schiebt die Termin-Daten der App in die App Group,
 * damit das Homescreen-Widget (SmartNoteWidget) sie lesen kann.
 */
@objc(NZWidgetPlugin)
public class NZWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NZWidgetPlugin"
    public let jsName = "NZWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise)
    ]

    @objc func update(_ call: CAPPluginCall) {
        let json = call.getString("json") ?? "[]"
        if let ud = UserDefaults(suiteName: "group.com.getsmartnote.app") {
            ud.set(json, forKey: "termine")
        }
        if #available(iOS 14.0, *) {
            WidgetCenter.shared.reloadAllTimelines()
        }
        call.resolve(["ok": true])
    }
}
