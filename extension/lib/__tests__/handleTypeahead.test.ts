import { describe, it, expect } from 'vitest';
import {
  HANDLE_TYPEAHEAD_MIN_LENGTH,
  shouldQueryHandleTypeahead,
} from '@aturi/atproto/appview';

describe('shouldQueryHandleTypeahead', () => {
  it('queries once a plausible handle prefix is typed', () => {
    expect(shouldQueryHandleTypeahead('dam')).toBe(true);
    expect(shouldQueryHandleTypeahead('dame.bsky.social')).toBe(true);
    expect(shouldQueryHandleTypeahead('alice')).toBe(true);
  });

  it('stays quiet below the minimum length', () => {
    expect(shouldQueryHandleTypeahead('')).toBe(false);
    expect(shouldQueryHandleTypeahead('d')).toBe(false);
    expect(shouldQueryHandleTypeahead('da')).toBe(false);
    expect(HANDLE_TYPEAHEAD_MIN_LENGTH).toBe(3);
  });

  it('ignores surrounding whitespace when measuring', () => {
    expect(shouldQueryHandleTypeahead('  da  ')).toBe(false);
    expect(shouldQueryHandleTypeahead('  dam  ')).toBe(true);
  });

  it('skips DIDs, which the appview typeahead does not index', () => {
    expect(shouldQueryHandleTypeahead('did:plc:ewvi7nxzyoun6zhxrhs64oiz')).toBe(false);
    expect(shouldQueryHandleTypeahead('did:web:example.com')).toBe(false);
  });

  it('skips at:// URIs and anything carrying a path', () => {
    expect(shouldQueryHandleTypeahead('at://did:plc:x/app.bsky.feed.post/a')).toBe(false);
    expect(shouldQueryHandleTypeahead('example.com/alice')).toBe(false);
  });

  it('skips values with spaces, which are never handles', () => {
    expect(shouldQueryHandleTypeahead('alice smith')).toBe(false);
  });

  /**
   * The point of the whole component: a handle the AppView has never indexed
   * is still a handle. Returning `false` here would be a bug — these are
   * queried, come back empty, and remain submittable either way.
   */
  it('still queries handles that the appview will not know', () => {
    expect(shouldQueryHandleTypeahead('dame.spaces')).toBe(true);
    expect(shouldQueryHandleTypeahead('alice.self-hosted.example')).toBe(true);
  });
});
