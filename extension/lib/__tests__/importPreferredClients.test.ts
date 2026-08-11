import { describe, it, expect } from 'vitest';
import type { PreferredClientsRecord } from '@aturi/preferredClients';
import {
  familiesForScope,
  favoritesFromPreferredClients,
} from '../importPreferredClients';

describe('familiesForScope', () => {
  it('maps a namespace to the family that renders it', () => {
    expect(familiesForScope('app.bsky.*')).toContain('bluesky-social');
    expect(familiesForScope('pub.leaflet.*')).toContain('standard-site');
    expect(familiesForScope('site.standard.*')).toContain('standard-site');
    expect(familiesForScope('sh.tangled.*')).toContain('tangled');
  });

  it('does not let a dual-family app leak one namespace into another', () => {
    // Anisota is in both `bluesky-social` and `standard-site`. A naive union
    // over matching waypoints would have `app.bsky.*` claim the publications
    // slot through it, quietly overriding whatever the user chose for Leaflet
    // documents.
    expect(familiesForScope('app.bsky.*')).not.toContain('standard-site');
    expect(familiesForScope('pub.leaflet.*')).not.toContain('bluesky-social');
  });

  it('gives the catch-all to the generic record explorers', () => {
    expect(familiesForScope('*')).toEqual(['atproto-explorer']);
  });

  it('matches an exact collection as well as a wildcard', () => {
    expect(familiesForScope('app.bsky.feed.post')).toContain('bluesky-social');
  });

  it('returns nothing for a namespace no catalog app declares', () => {
    expect(familiesForScope('com.example.*')).toEqual([]);
  });
});

describe('favoritesFromPreferredClients', () => {
  const record: PreferredClientsRecord = {
    preferences: [
      { scope: '*', clients: [{ id: 'pdsls', name: 'PDSls' }] },
      { scope: 'app.bsky.*', clients: [{ id: 'blacksky', name: 'Blacksky' }] },
      { scope: 'pub.leaflet.*', clients: [{ id: 'leaflet', name: 'Leaflet' }] },
    ],
  };

  it('maps each rule onto the family it speaks for', () => {
    expect(favoritesFromPreferredClients(record)).toEqual({
      'bluesky-social': 'blacksky',
      'standard-site': 'leaflet',
      'atproto-explorer': 'pdsls',
    });
  });

  it('lets the most specific rule win a family', () => {
    const favorites = favoritesFromPreferredClients({
      preferences: [
        { scope: 'app.bsky.*', clients: [{ id: 'anisota', name: 'Anisota' }] },
        { scope: 'app.bsky.feed.post', clients: [{ id: 'deer', name: 'Deer' }] },
      ],
    });
    expect(favorites['bluesky-social']).toBe('deer');
  });

  it('skips a client the catalog cannot build links for', () => {
    const favorites = favoritesFromPreferredClients({
      preferences: [
        {
          scope: 'app.bsky.*',
          clients: [
            { name: 'Self-hosted thing', templates: { post: 'https://x.example/{rkey}' } },
            { id: 'bluepy', name: 'Bluepy' },
          ],
        },
      ],
    });
    // The extension redirects by waypoint id, so it takes the first entry it
    // recognises rather than dropping the rule entirely.
    expect(favorites['bluesky-social']).toBe('bluepy');
  });

  it('ignores a rule whose client is not in the family the scope names', () => {
    // Tangled renders `sh.tangled` records and nothing else, so naming it for
    // publications says nothing about where Leaflet documents should open.
    const favorites = favoritesFromPreferredClients({
      preferences: [{ scope: 'pub.leaflet.*', clients: [{ id: 'tangled', name: 'Tangled' }] }],
    });
    expect(favorites).toEqual({});
  });

  it('returns nothing for an empty record', () => {
    expect(favoritesFromPreferredClients({ preferences: [] })).toEqual({});
  });
});
