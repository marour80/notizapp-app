import UIKit
import Capacitor

// Registriert unsere App-lokalen Capacitor-Plugins (NZRecorder mit Live-Pegel, NZWidget).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NZRecorderPlugin())
        bridge?.registerPluginInstance(NZWidgetPlugin())
        bridge?.registerPluginInstance(NZGeoPlugin())
    }
}
