import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDomainFor, groupPrefix } from '@/utils/ufos/nsid';

test('appDomainFor reverses the first two labels of a namespace', () => {
  assert.equal(appDomainFor('app.voresky'), 'voresky.app');
  assert.equal(appDomainFor('app.bsky.feed'), 'bsky.app');
  assert.equal(appDomainFor('com.atproto'), 'atproto.com');
  assert.equal(appDomainFor('App.Voresky'), 'voresky.app');
});

test('appDomainFor keeps the project label under per-project hosts', () => {
  assert.equal(appDomainFor('io.github.romiojoseph.blog'), 'romiojoseph.github.io');
  assert.equal(appDomainFor('app.vercel.dekoboko'), 'dekoboko.vercel.app');
  assert.equal(appDomainFor('app.netlify.stackstratum'), 'stackstratum.netlify.app');
  assert.equal(appDomainFor('dev.pages.updowndraft.feed'), 'updowndraft.pages.dev');
});

test('appDomainFor keeps the owner label under country second levels', () => {
  assert.equal(appDomainFor('ar.com.cabildoabierto'), 'cabildoabierto.com.ar');
  assert.equal(appDomainFor('id.ac.ui.cs.amanah'), 'ui.ac.id');
  // A generic TLD has no second level to skip.
  assert.equal(appDomainFor('com.example'), 'example.com');
});

test('appDomainFor returns null when no site can be named', () => {
  assert.equal(appDomainFor('app'), null);
  assert.equal(appDomainFor('io.github'), null);
  assert.equal(appDomainFor('uk.co'), null);
  assert.equal(appDomainFor('foo bar.baz'), null);
  assert.equal(appDomainFor('app.-voresky'), null);
  assert.equal(appDomainFor('9app.voresky'), null);
  assert.equal(appDomainFor('a.voresky'), null);
  assert.equal(appDomainFor('app..voresky'), null);
});

test('a full NSID goes through groupPrefix so its name is not a label', () => {
  assert.equal(appDomainFor(groupPrefix('app.voresky.post')), 'voresky.app');
  assert.equal(appDomainFor(groupPrefix('dev.pages.skywrite')), null);
});
