import Foundation

/// Proof Key for Code Exchange (RFC 7636), S256 only: atproto authorization
/// servers reject `plain`. The verifier is 32 random octets in base64url,
/// which is 43 characters of the unreserved set and the size the RFC
/// recommends; the challenge is base64url(SHA-256(verifier)).
public enum PKCE {
    public static let challengeMethod = "S256"

    /// RFC 7636 section 4.1: 43 to 128 characters of `[A-Za-z0-9-._~]`.
    public static let verifierCharacters = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")

    public static func generateVerifier() -> String {
        verifier(fromRandomBytes: OAuthRandom.bytes(count: 32))
    }

    /// The verifier a given entropy source yields; deterministic so tests
    /// can pin the challenge. Any byte count from 32 to 96 gives a legal
    /// length (43 to 128 characters).
    public static func verifier(fromRandomBytes bytes: [UInt8]) -> String {
        OAuthBase64URL.encode(Data(bytes))
    }

    public static func isValidVerifier(_ verifier: String) -> Bool {
        (43...128).contains(verifier.count) && verifier.allSatisfy { verifierCharacters.contains($0) }
    }

    /// base64url(SHA-256(ASCII(verifier))), no padding.
    public static func challenge(for verifier: String) -> String {
        OAuthBase64URL.encode(OAuthSHA256.hash(Data(verifier.utf8)))
    }
}

/// Unpadded base64url (RFC 4648 section 5), the alphabet JWTs, JWKs and
/// PKCE all use.
public enum OAuthBase64URL {
    public static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func decode(_ string: String) -> Data? {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder == 2 {
            base64 += "=="
        } else if remainder == 3 {
            base64 += "="
        } else if remainder == 1 {
            return nil
        }
        return Data(base64Encoded: base64)
    }
}

/// Cryptographically secure random bytes for verifiers, states and JWT ids.
/// `SystemRandomNumberGenerator` is backed by the platform CSPRNG (arc4random
/// on Darwin, getrandom on Linux).
public enum OAuthRandom {
    public static func bytes(count: Int) -> [UInt8] {
        var generator = SystemRandomNumberGenerator()
        return (0..<count).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    }

    /// base64url of `count` random bytes: the shape of `state` and `jti`.
    public static func token(bytes count: Int = 32) -> String {
        OAuthBase64URL.encode(Data(bytes(count: count)))
    }
}

/// SHA-256 (FIPS 180-4) in plain Swift. CryptoKit does not exist on Linux,
/// and the PKCE challenge and the DPoP `ath` claim are the only two hashes
/// this package needs, so a small self-contained implementation keeps the
/// OAuth layer testable off-device. Named to stay clear of CryptoKit's
/// `SHA256` in the app target, which imports both.
public enum OAuthSHA256 {
    private static let roundConstants: [UInt32] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ]

    private static let initialState: [UInt32] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]

    public static func hash(_ data: Data) -> Data {
        Data(hash([UInt8](data)))
    }

    public static func hash(_ message: [UInt8]) -> [UInt8] {
        // Padding: 0x80, zeros to 56 mod 64, then the bit length big-endian.
        var padded = message
        let bitLength = UInt64(message.count) * 8
        padded.append(0x80)
        while padded.count % 64 != 56 {
            padded.append(0)
        }
        for shift in stride(from: 56, through: 0, by: -8) {
            padded.append(UInt8(truncatingIfNeeded: bitLength >> UInt64(shift)))
        }

        var state = initialState
        var schedule = [UInt32](repeating: 0, count: 64)

        for chunkStart in stride(from: 0, to: padded.count, by: 64) {
            for i in 0..<16 {
                let offset = chunkStart + i * 4
                schedule[i] = UInt32(padded[offset]) << 24
                    | UInt32(padded[offset + 1]) << 16
                    | UInt32(padded[offset + 2]) << 8
                    | UInt32(padded[offset + 3])
            }
            for i in 16..<64 {
                let w15 = schedule[i - 15]
                let w2 = schedule[i - 2]
                let s0 = rotateRight(w15, 7) ^ rotateRight(w15, 18) ^ (w15 >> 3)
                let s1 = rotateRight(w2, 17) ^ rotateRight(w2, 19) ^ (w2 >> 10)
                schedule[i] = schedule[i - 16] &+ s0 &+ schedule[i - 7] &+ s1
            }

            var a = state[0], b = state[1], c = state[2], d = state[3]
            var e = state[4], f = state[5], g = state[6], h = state[7]

            for i in 0..<64 {
                let bigSigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
                let choose = (e & f) ^ (~e & g)
                let temp1 = h &+ bigSigma1 &+ choose &+ roundConstants[i] &+ schedule[i]
                let bigSigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
                let majority = (a & b) ^ (a & c) ^ (b & c)
                let temp2 = bigSigma0 &+ majority

                h = g
                g = f
                f = e
                e = d &+ temp1
                d = c
                c = b
                b = a
                a = temp1 &+ temp2
            }

            state[0] &+= a; state[1] &+= b; state[2] &+= c; state[3] &+= d
            state[4] &+= e; state[5] &+= f; state[6] &+= g; state[7] &+= h
        }

        var digest = [UInt8]()
        digest.reserveCapacity(32)
        for word in state {
            digest.append(UInt8(truncatingIfNeeded: word >> 24))
            digest.append(UInt8(truncatingIfNeeded: word >> 16))
            digest.append(UInt8(truncatingIfNeeded: word >> 8))
            digest.append(UInt8(truncatingIfNeeded: word))
        }
        return digest
    }

    /// Lowercase hex of the digest, the form test vectors are published in.
    public static func hexDigest(_ data: Data) -> String {
        hash([UInt8](data)).map { byte in
            let hex = String(byte, radix: 16)
            return hex.count == 1 ? "0" + hex : hex
        }.joined()
    }

    private static func rotateRight(_ value: UInt32, _ count: UInt32) -> UInt32 {
        (value >> count) | (value << (32 - count))
    }
}
