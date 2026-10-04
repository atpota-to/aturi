import Foundation
import Security

/// The smallest Keychain surface the session needs: one generic-password
/// item per account under the app's service name, Data in and Data out.
/// The session item holds the DPoP private key, which is why it lives
/// here and nowhere less protected.
///
/// Items are filed under the app group as their keychain access group so
/// the share extension can read the session should it ever need to. A
/// build without that entitlement (a simulator run signed with a personal
/// team) is answered with errSecMissingEntitlement; the store then retries
/// in the app's own default access group rather than failing.
struct KeychainStore {
    static let defaultService = "to.aturi.app.session"
    static let accessGroup = "group.to.aturi.app"

    enum KeychainError: Error, Equatable {
        case status(OSStatus)
    }

    let service: String

    init(service: String = KeychainStore.defaultService) {
        self.service = service
    }

    /// Replace the item for `account`, or create it.
    func save(_ data: Data, account: String) throws {
        try withAccessGroupFallback { group in
            var query = baseQuery(account: account, accessGroup: group)
            /* Delete-then-add rather than SecItemUpdate: an update needs a
               second query dictionary and behaves differently when the item
               is absent, while a fresh add is one code path for both cases. */
            let deleted = SecItemDelete(query as CFDictionary)
            guard deleted == errSecSuccess || deleted == errSecItemNotFound else { return deleted }
            query[kSecValueData as String] = data
            /* The token pair is bound to a key that only this device holds,
               and a session restored onto another device from a backup
               would still be honoured by the server, so the item is kept
               out of backups and iCloud Keychain. After first unlock, not
               when unlocked, so the refresh timer can fire in the
               background. */
            query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            return SecItemAdd(query as CFDictionary, nil)
        }
    }

    /// The item for `account`, or nil when there is none.
    func load(account: String) throws -> Data? {
        var found: Data?
        try withAccessGroupFallback { group in
            var query = baseQuery(account: account, accessGroup: group)
            query[kSecReturnData as String] = kCFBooleanTrue
            query[kSecMatchLimit as String] = kSecMatchLimitOne
            var item: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &item)
            if status == errSecSuccess {
                found = item as? Data
            }
            return status == errSecItemNotFound ? errSecSuccess : status
        }
        return found
    }

    /// Remove the item for `account`; a missing item is not an error.
    func delete(account: String) throws {
        try withAccessGroupFallback { group in
            let status = SecItemDelete(baseQuery(account: account, accessGroup: group) as CFDictionary)
            return status == errSecItemNotFound ? errSecSuccess : status
        }
    }

    private func baseQuery(account: String, accessGroup: String?) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }

    /// Run `operation` against the app group's access group, and once more
    /// against the default group when the entitlement is missing.
    private func withAccessGroupFallback(_ operation: (String?) -> OSStatus) throws {
        var status = operation(Self.accessGroup)
        if status == errSecMissingEntitlement {
            status = operation(nil)
        }
        guard status == errSecSuccess else {
            throw KeychainError.status(status)
        }
    }
}
