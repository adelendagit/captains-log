import SwiftUI
import UniformTypeIdentifiers
import UIKit

final class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        loadSharedPlace()
    }

    private func loadSharedPlace() {
        let providers = (extensionContext?.inputItems as? [NSExtensionItem] ?? [])
            .flatMap { $0.attachments ?? [] }
        if let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.url.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.url.identifier) { [weak self] item, _ in
                let url = item as? URL ?? (item as? NSURL).map { $0 as URL }
                DispatchQueue.main.async {
                    self?.showForm(seed: NavilyShareSeed(url: url, text: nil))
                }
            }
            return
        }
        if let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
        }) {
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { [weak self] item, _ in
                let text = item as? String
                let url = text.flatMap(NavilyShareParser.url(in:))
                DispatchQueue.main.async { self?.showForm(seed: NavilyShareSeed(url: url, text: text)) }
            }
            return
        }
        showMessage("Share a Navily place link to add it to Captain’s Log.")
    }

    private func showForm(seed: NavilyShareSeed) {
        guard let url = seed.url, NavilyShareParser.isNavilyURL(url) else {
            showMessage("The shared item does not contain a Navily place link.")
            return
        }
        guard let token = KeychainStore.read() else {
            showMessage("Open Captain’s Log and sign in to Trello before using the share action.")
            return
        }
        let root = AddPlaceView(
            api: APIClient(),
            token: token,
            seed: seed,
            onSaved: { [weak self] _ in self?.finish() },
            onCancel: { [weak self] in self?.finish() }
        )
        install(UIHostingController(rootView: root))
    }

    private func showMessage(_ message: String) {
        let root = NavigationStack {
            ContentUnavailableView(
                "Couldn’t Add Place",
                systemImage: "link.badge.plus",
                description: Text(message)
            )
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { [weak self] in self?.finish() }
                }
            }
        }
        install(UIHostingController(rootView: root))
    }

    private func install(_ controller: UIViewController) {
        children.forEach { child in
            child.willMove(toParent: nil)
            child.view.removeFromSuperview()
            child.removeFromParent()
        }
        addChild(controller)
        controller.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(controller.view)
        NSLayoutConstraint.activate([
            controller.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            controller.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            controller.view.topAnchor.constraint(equalTo: view.topAnchor),
            controller.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        controller.didMove(toParent: self)
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
