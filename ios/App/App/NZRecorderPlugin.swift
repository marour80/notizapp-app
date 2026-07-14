import Foundation
import AVFoundation
import Capacitor

/*
 * NZRecorder – eigener Sprach-Recorder mit LIVE-PEGEL (Metering).
 * Ersetzt capacitor-voice-recorder für Sprachnotizen: gleiche Aufgabe (AAC/m4a als Base64),
 * aber zusätzlich level() für die mitschwingende Aufnahme-Animation (wie der iOS-Sprachmemo-Recorder).
 */
@objc(NZRecorderPlugin)
public class NZRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NZRecorderPlugin"
    public let jsName = "NZRecorder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "level", returnType: CAPPluginReturnPromise)
    ]

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?

    @objc func start(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            guard granted else {
                call.resolve(["ok": false, "error": "permission"])
                return
            }
            DispatchQueue.main.async {
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
                    try session.setActive(true)
                    let url = FileManager.default.temporaryDirectory.appendingPathComponent("nz-voice-\(Date().timeIntervalSince1970).m4a")
                    let settings: [String: Any] = [
                        AVFormatIDKey: kAudioFormatMPEG4AAC,
                        AVSampleRateKey: 44100,
                        AVNumberOfChannelsKey: 1,
                        AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue
                    ]
                    let rec = try AVAudioRecorder(url: url, settings: settings)
                    rec.isMeteringEnabled = true
                    rec.record()
                    self.recorder = rec
                    self.fileURL = url
                    call.resolve(["ok": true])
                } catch {
                    call.resolve(["ok": false, "error": error.localizedDescription])
                }
            }
        }
    }

    // Aktueller Eingangspegel 0..1 (aus dB umgerechnet) – wird von der Orb-Animation gepollt.
    @objc func level(_ call: CAPPluginCall) {
        guard let rec = recorder, rec.isRecording else {
            call.resolve(["level": 0])
            return
        }
        rec.updateMeters()
        let db = rec.averagePower(forChannel: 0) // -160 (still) .. 0 (voll)
        let lin = pow(10.0, Double(db) / 20.0)
        call.resolve(["level": lin])
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard let rec = recorder, let url = fileURL else {
            call.resolve(["ok": false])
            return
        }
        rec.stop()
        recorder = nil
        do {
            let data = try Data(contentsOf: url)
            call.resolve(["ok": true, "base64": data.base64EncodedString(), "mimeType": "audio/aac", "msDuration": Int(rec.currentTime * 1000)])
        } catch {
            call.resolve(["ok": false, "error": error.localizedDescription])
        }
        try? FileManager.default.removeItem(at: url)
        fileURL = nil
    }

    @objc func cancel(_ call: CAPPluginCall) {
        recorder?.stop()
        recorder = nil
        if let u = fileURL { try? FileManager.default.removeItem(at: u) }
        fileURL = nil
        call.resolve(["ok": true])
    }
}
