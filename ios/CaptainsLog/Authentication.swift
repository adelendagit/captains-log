import AuthenticationServices
import Foundation
import Network
import UIKit

@MainActor
final class AuthenticationManager: NSObject, ObservableObject {
    @Published private(set) var token: String?
    @Published var errorMessage: String?
    @Published var isSigningIn = false
    @Published private(set) var isOffline = false
    @Published private(set) var pendingMutationCount = 0
    @Published private var signedOutExplicitly = false

    let api = APIClient()
    private var webSession: ASWebAuthenticationSession?
    private let pathMonitor = NWPathMonitor()
    private let pathMonitorQueue = DispatchQueue(label: "CaptainsLogConnectivity")
    private var mutationRetryTask: Task<Void, Never>?

    var canOpenApp: Bool {
        token != nil || (!signedOutExplicitly && isOffline && api.hasCachedPlanning)
    }

    override init() {
        token = KeychainStore.read()
        super.init()
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor [weak self] in
                await self?.connectionChanged(isOffline: path.status != .satisfied)
            }
        }
        pathMonitor.start(queue: pathMonitorQueue)
        Task {
            await refreshPendingMutationCount()
        }
    }

    func signIn() {
        errorMessage = nil
        isSigningIn = true
        let session = ASWebAuthenticationSession(
            url: api.loginURL,
            callbackURLScheme: "captainslog"
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.isSigningIn = false
                    if (error as? ASWebAuthenticationSessionError)?.code != .canceledLogin {
                        self.errorMessage = error.localizedDescription
                    }
                    return
                }
                guard
                    let callbackURL,
                    let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                    let code = components.queryItems?.first(where: { $0.name == "code" })?.value
                else {
                    self.isSigningIn = false
                    self.errorMessage = "Trello did not return a login code."
                    return
                }

                do {
                    let token = try await self.api.exchange(code: code)
                    try KeychainStore.save(token)
                    self.token = token
                    self.signedOutExplicitly = false
                    await self.syncPendingMutations()
                } catch {
                    self.errorMessage = error.localizedDescription
                }
                self.isSigningIn = false
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        webSession = session
        session.start()
    }

    func signOut() {
        KeychainStore.delete()
        signedOutExplicitly = true
        token = nil
    }

    func refreshPendingMutationCount() async {
        pendingMutationCount = await api.pendingMutationCount()
    }

    func syncPendingMutations() async {
        guard !isOffline, let token else {
            await refreshPendingMutationCount()
            return
        }
        let countBeforeSync = await api.pendingMutationCount()
        do {
            try await api.flushPendingMutations(token: token)
        } catch {
            // The durable queue remains intact and is retried with a short
            // delay as well as on the next connectivity change.
            schedulePendingMutationRetry()
        }
        await refreshPendingMutationCount()
        if pendingMutationCount == 0 {
            mutationRetryTask?.cancel()
            mutationRetryTask = nil
        }
        if countBeforeSync > pendingMutationCount {
            NotificationCenter.default.post(name: .captainsLogDidChange, object: nil)
        }
    }

    private func schedulePendingMutationRetry() {
        guard mutationRetryTask == nil else { return }
        mutationRetryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(30))
            guard !Task.isCancelled, let self else { return }
            self.mutationRetryTask = nil
            await self.syncPendingMutations()
        }
    }

    private func connectionChanged(isOffline: Bool) async {
        self.isOffline = isOffline
        if !isOffline {
            await syncPendingMutations()
        } else {
            await refreshPendingMutationCount()
        }
    }
}

extension AuthenticationManager: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
    }
}
