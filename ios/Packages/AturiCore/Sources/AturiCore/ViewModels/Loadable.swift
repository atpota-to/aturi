import Foundation

/// The lifecycle of one asynchronous load, shared by every view model so
/// the screens draw the same skeleton, error panel and content states.
///
/// `failed` carries a message rather than an `Error` because the screens
/// only ever print it, and a plain string keeps the enum `Equatable` and
/// `Sendable` whenever the value is. Errors that need a decision, such as
/// "not found" versus "the resolver is down", belong in the loaded value's
/// own type rather than in this wrapper.
public enum Loadable<Value> {
    case idle
    case loading
    case loaded(Value)
    case failed(String)

    /// The loaded value, nil in every other state.
    public var value: Value? {
        if case .loaded(let value) = self { return value }
        return nil
    }

    public var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    public var isIdle: Bool {
        if case .idle = self { return true }
        return false
    }

    /// The failure message, nil unless the load failed.
    public var errorMessage: String? {
        if case .failed(let message) = self { return message }
        return nil
    }

    public var isFailed: Bool {
        errorMessage != nil
    }
}

extension Loadable: Equatable where Value: Equatable {}
extension Loadable: Hashable where Value: Hashable {}
extension Loadable: Sendable where Value: Sendable {}
