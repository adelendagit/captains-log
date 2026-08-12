import CoreLocation
import MapKit
import SwiftUI
import UniformTypeIdentifiers

struct NavilyShareSeed {
    let url: URL?
    let text: String?

    var coordinate: CLLocationCoordinate2D? {
        NavilyShareParser.coordinate(in: text ?? "")
    }

    var suggestedName: String? {
        let capturedTitle = text?
            .components(separatedBy: .newlines)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let capturedTitle,
           !capturedTitle.isEmpty,
           capturedTitle.count <= 100,
           !capturedTitle.lowercased().hasPrefix("http") {
            return capturedTitle
        }
        return NavilyShareParser.suggestedName(from: url)
    }

    var suggestedDescription: String {
        guard let url, let text else { return "" }
        return NavilyPageParser.draft(url: url, title: suggestedName, text: text).summary
    }
}

enum NavilyShareParser {
    static func url(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(
            types: NSTextCheckingResult.CheckingType.link.rawValue
        ) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        return detector.matches(in: text, range: range)
            .compactMap(\.url)
            .first(where: isNavilyURL)
    }

    static func isNavilyURL(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "navily.com" || host == "www.navily.com"
    }

    static func suggestedName(from url: URL?) -> String? {
        guard let url, isNavilyURL(url) else { return nil }
        for component in url.pathComponents.reversed() where component != "/" {
            let compactIdentifier = component.replacingOccurrences(of: "-", with: "")
            let isNumericIdentifier = component.allSatisfy(\.isNumber)
            let isLongHexIdentifier = compactIdentifier.count >= 24 && compactIdentifier.allSatisfy(\.isHexDigit)
            if isNumericIdentifier || isLongHexIdentifier { continue }
            let decoded = component.removingPercentEncoding ?? component
            let name = decoded
                .replacingOccurrences(of: "-", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if !name.isEmpty, !["mouillage", "port", "marina"].contains(name.lowercased()) {
                return name.capitalized
            }
        }
        return nil
    }

    static func coordinate(in text: String) -> CLLocationCoordinate2D? {
        let degreeMinutePattern = #"(\d{1,2})\s*°\s*(\d{1,2}(?:[.,]\d+)?)\s*['’]?\s*([NS])\s*[,;\s]+\s*(\d{1,3})\s*°\s*(\d{1,2}(?:[.,]\d+)?)\s*['’]?\s*([EW])"#
        if let values = captures(pattern: degreeMinutePattern, in: text), values.count == 6,
           let latDegrees = Double(values[0]),
           let latMinutes = Double(values[1].replacingOccurrences(of: ",", with: ".")),
           let lngDegrees = Double(values[3]),
           let lngMinutes = Double(values[4].replacingOccurrences(of: ",", with: ".")) {
            let latSign = values[2].uppercased() == "S" ? -1.0 : 1.0
            let lngSign = values[5].uppercased() == "W" ? -1.0 : 1.0
            let coordinate = CLLocationCoordinate2D(
                latitude: latSign * (latDegrees + latMinutes / 60),
                longitude: lngSign * (lngDegrees + lngMinutes / 60)
            )
            if CLLocationCoordinate2DIsValid(coordinate) { return coordinate }
        }

        let decimalPattern = #"(-?\d{1,2}(?:[.]\d+)?)\s*[,;]\s*(-?\d{1,3}(?:[.]\d+)?)"#
        if let values = captures(pattern: decimalPattern, in: text), values.count == 2,
           let lat = Double(values[0]), let lng = Double(values[1]) {
            let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            if CLLocationCoordinate2DIsValid(coordinate) { return coordinate }
        }
        return nil
    }

    private static func captures(pattern: String, in text: String) -> [String]? {
        guard let expression = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
            return nil
        }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = expression.firstMatch(in: text, range: range) else { return nil }
        return (1..<match.numberOfRanges).compactMap { index in
            guard let range = Range(match.range(at: index), in: text) else { return nil }
            return String(text[range])
        }
    }
}

enum NavilyPageParser {
    private static let headings: [[String]] = [
        ["characteristics", "caractéristiques"],
        ["seabed types", "types de fond"],
        ["reachable by dinghy", "accessible en annexe"],
        ["mooring field information", "informations sur le champ de bouées"],
        ["weather and protection", "météo & protection", "weather & protection"],
        ["shops nearby", "commerces à proximité"],
        ["the community's opinion", "l'avis de la communauté"],
        ["anchorages close", "marinas close", "mouillages à proximité", "ports à proximité"],
    ]

    static func draft(
        url: URL,
        title: String?,
        text: String,
        dinghyFacilities: [String]? = nil
    ) -> NavilySnapshotDraft {
        let lines = normalizedLines(text)
        let characteristics = merged(
            section(aliases: headings[0], lines: lines),
            section(aliases: headings[3], lines: lines)
        )
        let seabed = section(aliases: headings[1], lines: lines)
        let shops = section(aliases: headings[5], lines: lines)
            .filter { !isEmptyFacilityMessage($0) }
        let facilities = merged(
            dinghyFacilities ?? section(aliases: headings[2], lines: lines),
            shops
        )
        let name = cleanTitle(title) ?? NavilyShareParser.suggestedName(from: url)
        let coordinate = NavilyShareParser.coordinate(in: text)
        var parts = [
            characteristics.isEmpty ? nil : "Characteristics: \(characteristics.joined(separator: ", ")).",
            seabed.isEmpty ? nil : "Seabed: \(seabed.joined(separator: ", ")).",
        ].compactMap { $0 }
        if let dinghyFacilities {
            parts.append(
                dinghyFacilities.isEmpty
                    ? "Reachable by dinghy: None."
                    : "Reachable by dinghy: \(dinghyFacilities.joined(separator: ", "))."
            )
            if !shops.isEmpty {
                parts.append("Shops nearby: \(shops.joined(separator: ", ")).")
            }
        } else if !facilities.isEmpty {
            parts.append("Facilities: \(facilities.joined(separator: ", ")).")
        }
        return NavilySnapshotDraft(
            sourceUrl: url,
            name: name,
            lat: coordinate?.latitude,
            lng: coordinate?.longitude,
            summary: parts.joined(separator: " "),
            characteristics: characteristics,
            seabed: seabed,
            facilities: facilities
        )
    }

    private static func normalizedLines(_ text: String) -> [String] {
        var result: [String] = []
        for rawLine in text.components(separatedBy: .newlines) {
            let line = rawLine
                .replacingOccurrences(of: " ", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !line.isEmpty, result.last?.localizedCaseInsensitiveCompare(line) != .orderedSame else {
                continue
            }
            result.append(line)
        }
        return result
    }

    private static func section(aliases: [String], lines: [String]) -> [String] {
        guard let start = lines.firstIndex(where: { line in
            aliases.contains { line.localizedCaseInsensitiveContains($0) }
        }) else { return [] }
        var values: [String] = []
        for line in lines.dropFirst(start + 1) {
            if isHeading(line) { break }
            let lower = line.lowercased()
            guard line.count <= 100,
                  !lower.hasPrefix("here "),
                  !lower.hasPrefix("you'll "),
                  !lower.hasPrefix("you will "),
                  !lower.hasPrefix("vous "),
                  !lower.hasPrefix("voici "),
                  !lower.hasPrefix("weather"),
                  !lower.hasPrefix("protection"),
                  !lower.hasPrefix("image"),
                  !lower.contains("not available for this time"),
                  !aliases.contains(where: { lower.contains($0) }) else { continue }
            if !values.contains(where: { $0.localizedCaseInsensitiveCompare(line) == .orderedSame }) {
                values.append(line)
            }
            if values.count == 12 { break }
        }
        return values
    }

    private static func merged(_ lists: [String]...) -> [String] {
        lists.flatMap { $0 }.reduce(into: []) { result, value in
            if !result.contains(where: { $0.localizedCaseInsensitiveCompare(value) == .orderedSame }) {
                result.append(value)
            }
        }
    }

    private static func isEmptyFacilityMessage(_ value: String) -> Bool {
        let lower = value.lowercased()
        return lower.hasPrefix("no shops listed") ||
            lower.hasPrefix("no shop listed") ||
            lower.hasPrefix("aucun commerce") ||
            lower.hasPrefix("pas de commerce")
    }

    private static func isHeading(_ line: String) -> Bool {
        let lower = line.lowercased()
        return headings.flatMap { $0 }.contains { lower.contains($0) }
    }

    private static func cleanTitle(_ title: String?) -> String? {
        guard var title = title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty else {
            return nil
        }
        for separator in [" on Navily", " sur Navily", " | Navily", " - Navily"] {
            if let range = title.range(of: separator, options: .caseInsensitive) {
                title = String(title[..<range.lowerBound])
            }
        }
        return title.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct AddPlaceView: View {
    private let api: APIClient
    private let token: String
    private let onSaved: (PlaceSummary) -> Void
    private let onCancel: () -> Void

    @State private var name: String
    @State private var description: String
    @State private var navilyURL: String
    @State private var latitude: String
    @State private var longitude: String
    @State private var lists: [PlaceListOption] = []
    @State private var selectedListID = ""
    @State private var camera: MapCameraPosition
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        api: APIClient,
        token: String,
        initialCoordinate: CLLocationCoordinate2D? = nil,
        seed: NavilyShareSeed = NavilyShareSeed(url: nil, text: nil),
        onSaved: @escaping (PlaceSummary) -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.api = api
        self.token = token
        self.onSaved = onSaved
        self.onCancel = onCancel
        let importedCoordinate = seed.coordinate
        let center = importedCoordinate ?? initialCoordinate ?? CLLocationCoordinate2D(latitude: 38, longitude: 23)
        _name = State(initialValue: seed.suggestedName ?? "")
        _description = State(initialValue: seed.suggestedDescription)
        _navilyURL = State(initialValue: seed.url?.absoluteString ?? "")
        _latitude = State(initialValue: importedCoordinate.map { Self.coordinateText($0.latitude) } ?? "")
        _longitude = State(initialValue: importedCoordinate.map { Self.coordinateText($0.longitude) } ?? "")
        _camera = State(initialValue: .region(MKCoordinateRegion(
            center: center,
            latitudinalMeters: importedCoordinate == nil ? 120_000 : 4_000,
            longitudinalMeters: importedCoordinate == nil ? 120_000 : 4_000
        )))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Navily") {
                    TextField("Navily place URL", text: $navilyURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onChange(of: navilyURL) { suggestNameFromURL() }
                    PasteButton(payloadType: URL.self) { urls in
                        guard let url = urls.first else { return }
                        navilyURL = url.absoluteString
                    }
                    .labelStyle(.titleAndIcon)
                    if !navilyURL.isEmpty && !hasValidNavilyURL {
                        Label("Enter a navily.com place link.", systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }

                Section("Place") {
                    TextField("Name", text: $name)
                    if isLoading {
                        ProgressView("Loading Trello lists…")
                    } else {
                        Picker("Area", selection: $selectedListID) {
                            Text("Select an area").tag("")
                            ForEach(lists) { list in Text(list.name).tag(list.id) }
                        }
                    }
                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(2...8)
                        .onChange(of: description) { enforceDescriptionLimit() }
                    Text("\(description.utf16.count)/16,384")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Position") {
                    Text("Tap the map to place or move the pin.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    MapReader { proxy in
                        Map(position: $camera) {
                            if let coordinate {
                                Annotation("New place", coordinate: coordinate) {
                                    Image(systemName: "mappin.circle.fill")
                                        .font(.title)
                                        .foregroundStyle(.red)
                                        .background(.white, in: Circle())
                                }
                            }
                        }
                        .mapStyle(.standard(elevation: .realistic))
                        .frame(height: 280)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                        .simultaneousGesture(
                            SpatialTapGesture().onEnded { value in
                                guard let coordinate = proxy.convert(value.location, from: .local) else { return }
                                setCoordinate(coordinate)
                            }
                        )
                    }
                    HStack {
                        TextField("Latitude", text: $latitude)
                            .keyboardType(.numbersAndPunctuation)
                        TextField("Longitude", text: $longitude)
                            .keyboardType(.numbersAndPunctuation)
                    }
                    if !latitude.isEmpty || !longitude.isEmpty, coordinate == nil {
                        Label("Enter a valid latitude and longitude.", systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Add Place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel).disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving { ProgressView() } else { Text("Save") }
                    }
                    .disabled(!canSave || isSaving)
                }
            }
            .task { await loadLists() }
        }
    }

    private var coordinate: CLLocationCoordinate2D? {
        guard let lat = Double(latitude), let lng = Double(longitude) else { return nil }
        let coordinate = CLLocationCoordinate2D(latitude: lat, longitude: lng)
        return CLLocationCoordinate2DIsValid(coordinate) ? coordinate : nil
    }

    private var hasValidNavilyURL: Bool {
        guard let url = URL(string: navilyURL.trimmingCharacters(in: .whitespacesAndNewlines)) else {
            return false
        }
        return NavilyShareParser.isNavilyURL(url)
    }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            name.utf16.count <= 256 &&
            hasValidNavilyURL &&
            coordinate != nil &&
            !selectedListID.isEmpty &&
            !isLoading
    }

    @MainActor private func loadLists() async {
        do {
            let planning = try await api.planning(token: token)
            lists = planning.placeLists ?? []
            if selectedListID.isEmpty { selectedListID = lists.first?.id ?? "" }
            errorMessage = lists.isEmpty ? "No Trello place lists are available." : nil
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor private func save() async {
        guard let coordinate else { return }
        isSaving = true
        errorMessage = nil
        do {
            let place = try await api.createPlace(
                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                description: description,
                listID: selectedListID,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                navilyURL: navilyURL.trimmingCharacters(in: .whitespacesAndNewlines),
                token: token
            )
            onSaved(place)
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }

    private func setCoordinate(_ coordinate: CLLocationCoordinate2D) {
        latitude = Self.coordinateText(coordinate.latitude)
        longitude = Self.coordinateText(coordinate.longitude)
    }

    private func suggestNameFromURL() {
        guard name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let url = URL(string: navilyURL),
              let suggestion = NavilyShareParser.suggestedName(from: url) else { return }
        name = suggestion
    }

    private func enforceDescriptionLimit() {
        while description.utf16.count > 16_384 { description.removeLast() }
    }

    private static func coordinateText(_ value: Double) -> String {
        String(format: "%.6f", value)
    }
}
