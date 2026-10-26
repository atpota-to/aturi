import SwiftUI
import AturiCore

/// Draws one `Loadable` the same way on every screen: skeleton while
/// loading (and, by default, while idle, which covers the frame before a
/// `.task` fires), the error panel with retry on failure, the caller's
/// content once loaded.
struct LoadableView<Value, Content: View>: View {
    let state: Loadable<Value>
    var retry: (() -> Void)? = nil
    /// Idle also means "not applicable to this input"; pass false where a
    /// section is only ever idle for that reason, so it draws nothing.
    var idleShowsSkeleton: Bool = true
    var skeletonRows: Int = 3
    let content: (Value) -> Content

    init(
        state: Loadable<Value>,
        retry: (() -> Void)? = nil,
        idleShowsSkeleton: Bool = true,
        skeletonRows: Int = 3,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.state = state
        self.retry = retry
        self.idleShowsSkeleton = idleShowsSkeleton
        self.skeletonRows = skeletonRows
        self.content = content
    }

    var body: some View {
        switch state {
        case .idle:
            if idleShowsSkeleton {
                SkeletonRows(count: skeletonRows)
            }
        case .loading:
            SkeletonRows(count: skeletonRows)
        case .loaded(let value):
            content(value)
        case .failed(let message):
            ErrorPanel(message: message, retry: retry)
        }
    }
}
