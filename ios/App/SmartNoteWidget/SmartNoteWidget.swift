import WidgetKit
import SwiftUI

/*
 * SmartNote Homescreen-Widget: zeigt die nächsten Termine.
 * Daten kommen aus der App über die App Group (UserDefaults, Key "termine"):
 * JSON-Array [{id, title, when}] – when = "2026-07-15T20:00" oder "2026-07-15".
 */

let APP_GROUP = "group.com.getsmartnote.app"

struct TerminItem: Codable, Identifiable {
    let id: String
    let title: String
    let when: String
}

struct TerminEntry: TimelineEntry {
    let date: Date
    let termine: [TerminItem]
}

func parseWhen(_ s: String) -> Date? {
    let df = DateFormatter()
    df.locale = Locale(identifier: "en_US_POSIX")
    df.timeZone = TimeZone.current
    df.dateFormat = s.contains("T") ? "yyyy-MM-dd'T'HH:mm" : "yyyy-MM-dd"
    return df.date(from: s)
}

func loadTermine() -> [TerminItem] {
    guard let ud = UserDefaults(suiteName: APP_GROUP),
          let raw = ud.string(forKey: "termine"),
          let data = raw.data(using: .utf8),
          let items = try? JSONDecoder().decode([TerminItem].self, from: data)
    else { return [] }
    let now = Date().addingTimeInterval(-3600) // gerade Vorbeigegangenes noch kurz zeigen
    return items
        .compactMap { it -> (TerminItem, Date)? in
            guard let d = parseWhen(it.when) else { return nil }
            return d >= now ? (it, d) : nil
        }
        .sorted { $0.1 < $1.1 }
        .map { $0.0 }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> TerminEntry {
        TerminEntry(date: Date(), termine: [
            TerminItem(id: "1", title: "Padel mit Patrick", when: "2026-07-15T20:00"),
            TerminItem(id: "2", title: "Zahnarzt", when: "2026-07-17T09:00")
        ])
    }
    func getSnapshot(in context: Context, completion: @escaping (TerminEntry) -> Void) {
        completion(TerminEntry(date: Date(), termine: context.isPreview ? placeholder(in: context).termine : loadTermine()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TerminEntry>) -> Void) {
        let entry = TerminEntry(date: Date(), termine: loadTermine())
        let next = Date().addingTimeInterval(30 * 60) // alle 30 Min. auffrischen
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// ---- Farben (Teal-Theme der App) ----
let tealColor = Color(red: 0.329, green: 0.859, blue: 0.784)
let bgColor = Color(red: 0.047, green: 0.078, blue: 0.106)
let dimColor = Color(white: 0.62)

struct DayTile: View {
    let date: Date
    var body: some View {
        VStack(spacing: 1) {
            Text(date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                .font(.system(size: 9, weight: .heavy))
                .foregroundColor(tealColor)
            Text(date.formatted(.dateTime.day()))
                .font(.system(size: 17, weight: .heavy))
                .foregroundColor(.white)
        }
        .frame(width: 36, height: 38)
        .background(tealColor.opacity(0.15))
        .overlay(RoundedRectangle(cornerRadius: 9).stroke(tealColor.opacity(0.35), lineWidth: 1))
        .cornerRadius(9)
    }
}

struct TermineView: View {
    let entry: TerminEntry
    @Environment(\.widgetFamily) var family

    var maxRows: Int { family == .systemSmall ? 2 : 3 }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 4) {
                Text("📅").font(.system(size: 11))
                Text("TERMINE")
                    .font(.system(size: 10, weight: .heavy))
                    .kerning(1.2)
                    .foregroundColor(tealColor)
                Spacer()
            }
            if entry.termine.isEmpty {
                Spacer()
                HStack {
                    Spacer()
                    VStack(spacing: 4) {
                        Text("🎉").font(.system(size: 22))
                        Text("Keine Termine").font(.system(size: 11, weight: .semibold)).foregroundColor(dimColor)
                    }
                    Spacer()
                }
                Spacer()
            } else {
                ForEach(entry.termine.prefix(maxRows)) { it in
                    HStack(spacing: 8) {
                        if let d = parseWhen(it.when) {
                            DayTile(date: d)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(it.title)
                                .font(.system(size: 12.5, weight: .bold))
                                .foregroundColor(.white)
                                .lineLimit(1)
                            if it.when.contains("T"), let d = parseWhen(it.when) {
                                Text(d.formatted(.dateTime.hour().minute()))
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(dimColor)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                }
                Spacer(minLength: 0)
            }
        }
        .padding(12)
    }
}

struct SmartNoteWidget: Widget {
    let kind: String = "SmartNoteWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            if #available(iOSApplicationExtension 17.0, *) {
                TermineView(entry: entry)
                    .containerBackground(for: .widget) { bgColor }
            } else {
                TermineView(entry: entry)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(bgColor)
            }
        }
        .configurationDisplayName("Nächste Termine")
        .description("Deine anstehenden SmartNote-Termine auf einen Blick.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct SmartNoteWidgetBundle: WidgetBundle {
    var body: some Widget {
        SmartNoteWidget()
    }
}
