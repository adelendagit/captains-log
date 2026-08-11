import SwiftUI
import WebKit

struct NavilyCheckView: View {
    @Environment(\.dismiss) private var dismiss

    let place: PlaceSummary
    let api: APIClient
    let token: String
    let onSaved: (NavilySnapshot) -> Void

    @State private var draft: NavilySnapshotDraft?
    @State private var summary = ""
    @State private var reloadID = 0
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let url = place.navilyUrl {
                    NavilyWebView(url: url, reloadID: reloadID) { title, text in
                        let captured = NavilyPageParser.draft(url: url, title: title, text: text)
                        draft = captured
                        summary = captured.summary
                        errorMessage = nil
                    } onError: { message in
                        errorMessage = message
                    }
                    .frame(minHeight: 330)
                }

                Divider()

                Form {
                    if let previous = place.navilySnapshot {
                        Section("Previous snapshot") {
                            LabeledContent(
                                "Checked",
                                value: previous.checkedAt.formatted(date: .abbreviated, time: .shortened)
                            )
                            if !previous.summary.isEmpty { Text(previous.summary).font(.footnote) }
                        }
                    }

                    if let draft {
                        Section("Captured from Navily") {
                            if let lat = draft.lat, let lng = draft.lng {
                                LabeledContent(
                                    "Position",
                                    value: String(format: "%.5f, %.5f", lat, lng)
                                )
                            }
                            detail("Characteristics", values: draft.characteristics)
                            detail("Seabed", values: draft.seabed)
                            detail("Facilities", values: draft.facilities)
                            if draft.characteristics.isEmpty &&
                                draft.seabed.isEmpty &&
                                draft.facilities.isEmpty {
                                Label(
                                    "No structured facts were recognized. Let the page finish loading, then tap Extract Again.",
                                    systemImage: "exclamationmark.triangle"
                                )
                                .font(.footnote)
                                .foregroundStyle(.orange)
                            }
                        }

                        Section("Snapshot summary") {
                            TextField("Summary", text: $summary, axis: .vertical)
                                .lineLimit(2...8)
                                .onChange(of: summary) {
                                    while summary.utf16.count > 2_000 { summary.removeLast() }
                                }
                            Text("\(summary.utf16.count)/2,000")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Section {
                            ProgressView("Waiting for the Navily page…")
                            Text("You can interact with the page above if Navily asks for confirmation.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
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
                .frame(maxHeight: 380)
            }
            .navigationTitle("Check Navily")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }.disabled(isSaving)
                }
                ToolbarItemGroup(placement: .confirmationAction) {
                    Button {
                        reloadID += 1
                    } label: {
                        Label("Extract Again", systemImage: "arrow.clockwise")
                    }
                    .disabled(isSaving)

                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving { ProgressView() } else { Text("Save") }
                    }
                    .disabled(!canSave || isSaving)
                }
            }
        }
    }

    @ViewBuilder
    private func detail(_ label: String, values: [String]) -> some View {
        if !values.isEmpty {
            LabeledContent(label) {
                Text(values.joined(separator: ", "))
                    .multilineTextAlignment(.trailing)
            }
        }
    }

    private var canSave: Bool {
        guard let draft else { return false }
        return !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            !draft.characteristics.isEmpty || !draft.seabed.isEmpty || !draft.facilities.isEmpty
    }

    @MainActor private func save() async {
        guard let draft else { return }
        isSaving = true
        errorMessage = nil
        let confirmed = NavilySnapshotDraft(
            sourceUrl: draft.sourceUrl,
            name: draft.name,
            lat: draft.lat,
            lng: draft.lng,
            summary: summary.trimmingCharacters(in: .whitespacesAndNewlines),
            characteristics: draft.characteristics,
            seabed: draft.seabed,
            facilities: draft.facilities
        )
        do {
            let snapshot = try await api.saveNavilySnapshot(
                cardID: place.placeCardID,
                draft: confirmed,
                token: token
            )
            onSaved(snapshot)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

private struct NavilyWebView: UIViewRepresentable {
    let url: URL
    let reloadID: Int
    let onCapture: (String?, String) -> Void
    let onError: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        guard context.coordinator.lastReloadID != reloadID else { return }
        context.coordinator.lastReloadID = reloadID
        webView.reload()
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: NavilyWebView
        var lastReloadID = 0

        init(parent: NavilyWebView) {
            self.parent = parent
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation?) {
            let script = """
            (() => ({
              title: document.querySelector('h1')?.innerText?.trim() || document.title,
              text: document.body?.innerText?.slice(0, 60000) || ''
            }))()
            """
            webView.evaluateJavaScript(script) { [weak self] result, error in
                guard let self else { return }
                if let error {
                    self.parent.onError(error.localizedDescription)
                    return
                }
                guard let values = result as? [String: Any],
                      let text = values["text"] as? String,
                      !text.isEmpty else {
                    self.parent.onError("Navily returned an empty page.")
                    return
                }
                self.parent.onCapture(values["title"] as? String, text)
            }
        }

        func webView(
            _ webView: WKWebView,
            didFail navigation: WKNavigation?,
            withError error: Error
        ) {
            parent.onError(error.localizedDescription)
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation?,
            withError error: Error
        ) {
            parent.onError(error.localizedDescription)
        }
    }
}
