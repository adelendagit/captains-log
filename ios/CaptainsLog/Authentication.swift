import AuthenticationServices
import Foundation
import Security
import UIKit

@MainActor
final class AuthenticationManager: NSObject, ObservableObject {
    @Published private(set) var token: String?
    @Published var errorMessage: String?
    @Published var isSigningIn = false

    let api = APIClient()
    private var webSession: ASWebAuthenticationSession?

    override init() {
        token = KeychainStore.read()
        super.init()
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
        token = nil
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

private enum KeychainStore {
    static let service = "co.uk.achilleas.captains-log"
    static let account = "mobile-api-token"

    static func save(_ token: String) throws {
        delete()
        let status = SecItemAdd([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecValueData: Data(token.utf8),
            kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ] as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw APIClientError.server("Unable to store the login securely.")
        }
    }

    static func read() -> String? {
        var result: CFTypeRef?
        let status = SecItemCopyMatching([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
            kSecReturnData: true,
            kSecMatchLimit: kSecMatchLimitOne,
        ] as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete() {
        SecItemDelete([
            kSecClass: kSecClassGenericPassword,
            kSecAttrService: service,
            kSecAttrAccount: account,
        ] as CFDictionary)
    }
}
