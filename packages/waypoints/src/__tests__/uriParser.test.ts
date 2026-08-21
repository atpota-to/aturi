import { describe, it, expect } from 'vitest';
import { parseURI } from '../uriParser';

/**
 * The universal-link route feeds `parseURI` three raw path segments. A
 * permissioned space address occupies the same first two positions as a public
 * record but means something entirely different, so the parser has to refuse
 * it rather than mint an `at://` URI naming a collection called `space`.
 */
describe('parseURI - space marker', () => {
  it('refuses the literal space marker in the collection position', () => {
    const parsed = parseURI('did:plc:x', 'space', 'com.example.forum');
    expect(parsed.type).toBe('unknown');
    expect(parsed.error).toBeTruthy();
    expect(parsed.collection).toBeUndefined();
    expect(parsed.uri).toBe('');
  });

  it('refuses the marker even without a third segment', () => {
    const parsed = parseURI('did:plc:x', 'space');
    expect(parsed.type).toBe('unknown');
    expect(parsed.error).toBeTruthy();
  });

  it('still parses an NSID that merely starts with the letters "space"', () => {
    // The test is exact-segment equality, never a prefix match: `space.…` is a
    // perfectly ordinary public collection.
    const parsed = parseURI('did:plc:x', 'space.example.thing', 'abc');
    expect(parsed.type).toBe('record');
    expect(parsed.collection).toBe('space.example.thing');
    expect(parsed.rkey).toBe('abc');
    expect(parsed.uri).toBe('at://did:plc:x/space.example.thing/abc');
  });
});

describe('parseURI - unchanged branches', () => {
  it('parses a profile', () => {
    const parsed = parseURI('alice.bsky.social');
    expect(parsed.type).toBe('profile');
    expect(parsed.uri).toBe('at://alice.bsky.social');
    expect(parsed.did).toBeUndefined();
  });

  it('parses a profile by DID', () => {
    const parsed = parseURI('did:plc:x');
    expect(parsed.type).toBe('profile');
    expect(parsed.did).toBe('did:plc:x');
  });

  it('parses a post', () => {
    const parsed = parseURI('alice.bsky.social', 'app.bsky.feed.post', 'abc');
    expect(parsed.type).toBe('post');
    expect(parsed.uri).toBe('at://alice.bsky.social/app.bsky.feed.post/abc');
  });

  it('parses a list', () => {
    const parsed = parseURI('alice.bsky.social', 'app.bsky.graph.list', 'abc');
    expect(parsed.type).toBe('list');
  });

  it('reports a missing handle', () => {
    expect(parseURI('').type).toBe('unknown');
  });

  it('reports a collection with no rkey as an invalid structure', () => {
    const parsed = parseURI('alice.bsky.social', 'app.bsky.feed.post');
    expect(parsed.type).toBe('unknown');
    expect(parsed.error).toBe('Invalid URI structure');
  });
});
