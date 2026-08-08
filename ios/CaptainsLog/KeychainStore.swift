import Foundation
import Security

enum KeychainStore {
    private static let service = "co.uk.achilleas.captains-log"
    private static let account = "mobile-api-token"
    private static var accessGroup: String {
        Bundle.main.object(forInfoDictionaryKey: "KEYCHAIN_ACCESS_GROUP") as? String
            ?? "4YHL9QWWA9.co.uk.achilleas.CaptainsLog.shared"
    }
#if targetEnvironment(simulator)
    private static let simulatorTokenKey = "simulator-mobile-api-token"
#endif

    static func save(_ token: String) throws {
        delete(accessGroup: accessGroup)
        let status = SecItemAdd(baseQuery(accessGroup: accessGroup).merging([
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]) { _, new in new } as CFDictionary, nil)
#if targetEnvironment(simulator)
        if status == errSecMissingEntitlement {
            UserDefaults.standard.set(token, forKey: simulatorTokenKey)
            return
        }
#endif
        guard status == errSecSuccess else {
            throw APIClientError.server("Unable to store the login securely.")
        }
    }

    static func read() -> String? {
        if let shared = read(accessGroup: accessGroup) { return shared }

        // Migrate credentials saved before the Share Extension introduced a shared group.
        if let legacy = read(accessGroup: nil) {
            try? save(legacy)
            delete(accessGroup: nil)
            return legacy
        }
#if targetEnvironment(simulator)
        return UserDefaults.standard.string(forKey: simulatorTokenKey)
#else
        return nil
#endif
    }

    static func delete() {
        delete(accessGroup: accessGroup)
        delete(accessGroup: nil)
#if targetEnvironment(simulator)
        UserDefaults.standard.removeObject(forKey: simulatorTokenKey)
#endif
    }

    private static func baseQuery(accessGroup: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
        return query
    }

    private static func read(accessGroup: String?) -> String? {
        var query = baseQuery(accessGroup: accessGroup)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func delete(accessGroup: String?) {
        SecItemDelete(baseQuery(accessGroup: accessGroup) as CFDictionary)
    }
}
