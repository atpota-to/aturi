import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconSrcFor, iconCandidates, isFaviconDomain, sniffIconType } from '@/utils/favicon';

test('isFaviconDomain accepts only domains appDomainFor can produce', () => {
  assert.equal(isFaviconDomain('bsky.app'), true);
  assert.equal(isFaviconDomain('romiojoseph.github.io'), true);
  assert.equal(isFaviconDomain('cabildoabierto.com.ar'), true);
  // Deeper than a registrable domain, so not something a namespace names.
  assert.equal(isFaviconDomain('internal.corp.example.com'), false);
  assert.equal(isFaviconDomain('github.io'), false);
  assert.equal(isFaviconDomain('Bsky.app'), false);
  assert.equal(isFaviconDomain('localhost'), false);
  assert.equal(isFaviconDomain('127.0.0.1'), false);
  assert.equal(isFaviconDomain('bsky.app:8080'), false);
  assert.equal(isFaviconDomain(''), false);
});

test('isFaviconDomain defers to the SSRF guard', () => {
  assert.equal(isFaviconDomain('printer.local'), false);
  assert.equal(isFaviconDomain('db.internal'), false);
});

test('faviconSrcFor maps a namespace to the route, or null', () => {
  assert.equal(faviconSrcFor('app.bsky'), '/api/favicon?domain=bsky.app');
  assert.equal(faviconSrcFor('app.bsky.feed'), '/api/favicon?domain=bsky.app');
  assert.equal(faviconSrcFor('a.guestbook'), null);
  assert.equal(faviconSrcFor('io.github'), null);
});

test('iconCandidates ranks a 32px icon over 16px, touch icons, and dark variants', () => {
  // bsky.app's head, plus a dark-scheme variant.
  const html = `
    <link rel="apple-touch-icon" sizes="180x180" href="https://web-cdn.bsky.app/static/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="16x16" href="https://web-cdn.bsky.app/static/favicon-16x16.png">
    <link rel="icon" type="image/png" sizes="32x32" href="https://web-cdn.bsky.app/static/favicon-32x32.png" media="(prefers-color-scheme: dark)">
    <link rel="icon" type="image/png" sizes="32x32" href="https://web-cdn.bsky.app/static/favicon-32x32.png?light">
    <link rel="mask-icon" href="https://web-cdn.bsky.app/static/safari-pinned-tab.svg" color="#1185fe">
    <link rel="stylesheet" href="/style.css">`;
  assert.deepEqual(iconCandidates(html, 'https://bsky.app/'), [
    'https://web-cdn.bsky.app/static/favicon-32x32.png?light',
    'https://web-cdn.bsky.app/static/favicon-32x32.png',
    'https://web-cdn.bsky.app/static/favicon-16x16.png',
    'https://web-cdn.bsky.app/static/apple-touch-icon.png',
    'https://bsky.app/favicon.ico',
  ]);
});

test('iconCandidates resolves relative hrefs, decodes entities, and reads any attribute order', () => {
  const html = `
    <LINK HREF='/icon.svg?v=1&amp;x=2' REL="icon" sizes=any type="image/svg+xml"/>
    <link href=/logos/dolly.ico rel="shortcut icon">`;
  assert.deepEqual(iconCandidates(html, 'https://frontpage.fyi/'), [
    'https://frontpage.fyi/icon.svg?v=1&x=2',
    'https://frontpage.fyi/logos/dolly.ico',
    'https://frontpage.fyi/favicon.ico',
  ]);
});

test('iconCandidates drops non-http hrefs and falls back to /favicon.ico', () => {
  const html = `
    <link rel="icon" href="data:image/png;base64,AAAA">
    <link rel="icon" href="javascript:alert(1)">`;
  assert.deepEqual(iconCandidates(html, 'https://example.com/'), ['https://example.com/favicon.ico']);
  assert.deepEqual(iconCandidates(null, 'https://example.com/'), ['https://example.com/favicon.ico']);
});

test('iconCandidates does not list /favicon.ico twice', () => {
  const html = `<link rel="icon" href="/favicon.ico">`;
  assert.deepEqual(iconCandidates(html, 'https://example.com/'), ['https://example.com/favicon.ico']);
});

test('sniffIconType reads formats from their bytes', () => {
  const bytes = (...b: number[]) => new Uint8Array(b);
  assert.equal(sniffIconType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'image/png');
  assert.equal(sniffIconType(bytes(0x00, 0x00, 0x01, 0x00, 0x01)), 'image/x-icon');
  assert.equal(sniffIconType(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'image/gif');
  assert.equal(sniffIconType(bytes(0xff, 0xd8, 0xff, 0xe0)), 'image/jpeg');
  assert.equal(
    sniffIconType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)),
    'image/webp',
  );
});

test('sniffIconType accepts SVG behind a prolog and refuses HTML', () => {
  const text = (s: string) => new TextEncoder().encode(s);
  assert.equal(sniffIconType(text('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(
    sniffIconType(text('﻿<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg>\n<svg viewBox="0 0 1 1"/>')),
    'image/svg+xml',
  );
  // A single-page app answering /favicon.ico with its shell.
  assert.equal(sniffIconType(text('<!DOCTYPE html><html><body><svg></svg></body></html>')), null);
  assert.equal(sniffIconType(text('<svgfoo>')), null);
  assert.equal(sniffIconType(new Uint8Array()), null);
});
