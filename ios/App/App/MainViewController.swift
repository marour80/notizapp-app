import UIKit
import Capacitor

// Registriert unsere App-lokalen Capacitor-Plugins (NZRecorder mit Live-Pegel).
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NZRecorderPlugin())
    }
}
