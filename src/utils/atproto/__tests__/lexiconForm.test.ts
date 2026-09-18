import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fieldFromProperty,
  formFromLexiconDocument,
  labelForProperty,
} from '@/utils/atproto/lexiconForm';
import type { LexiconField } from '@/utils/atproto/lexicons';

/**
 * The composer offers a form for lexicons nobody here has ever seen, which
 * means the form is only ever as right as this translation. These cover the
 * mappings a wrong answer would be invisible in — a closed enum rendered as a
 * free-text box, a byte ceiling shown where a grapheme one was meant — and the
 * documents that describe something a form can't be built from at all.
 */

function recordDoc(main: Record<string, unknown>) {
  return { lexicon: 1, id: 'com.example.thing', defs: { main: { type: 'record', ...main } } };
}

function fieldsOf(doc: unknown): LexiconField[] {
  const result = formFromLexiconDocument('com.example.thing', doc);
  assert.equal(result.ok, true, 'expected a form');
  return result.ok ? result.lexicon.fields : [];
}

function field(doc: unknown, key: string): LexiconField {
  const found = fieldsOf(doc).find((f) => f.key === key);
  assert.ok(found, `no field for ${key}`);
  return found;
}

test('scalars get native controls', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      required: ['createdAt'],
      properties: {
        createdAt: { type: 'string', format: 'datetime' },
        count: { type: 'integer' },
        pinned: { type: 'boolean' },
        handle: { type: 'string', maxLength: 253 },
      },
    },
  });

  assert.equal(field(doc, 'createdAt').type, 'datetime');
  assert.equal(field(doc, 'count').type, 'number');
  assert.equal(field(doc, 'pinned').type, 'boolean');
  assert.equal(field(doc, 'handle').type, 'text');
});

test('a required datetime with no default is seeded to now', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      required: ['createdAt'],
      properties: {
        createdAt: { type: 'string', format: 'datetime' },
        expiresAt: { type: 'string', format: 'datetime' },
      },
    },
  });

  assert.equal(field(doc, 'createdAt').default, 'now');
  // Optional ones are left alone: a form that pre-dated an expiry would be
  // writing a value the author never chose.
  assert.equal(field(doc, 'expiresAt').default, undefined);
});

test('enum is a closed select, knownValues an open one', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'closed'] },
        purpose: { type: 'string', knownValues: ['app.bsky.graph.defs#modlist'] },
      },
    },
  });

  const status = field(doc, 'status');
  assert.equal(status.type, 'select');
  assert.deepEqual(status.options, ['open', 'closed']);
  assert.equal(status.openOptions, undefined);

  const purpose = field(doc, 'purpose');
  assert.equal(purpose.type, 'select');
  assert.equal(purpose.openOptions, true);
});

test('maxGraphemes is the ceiling shown, not maxLength', () => {
  // A post declares 3000 bytes and 300 graphemes, and 300 is the number
  // everyone means by "the limit".
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 3000, maxGraphemes: 300 } },
    },
  });

  assert.equal(field(doc, 'text').maxLength, 300);
  assert.equal(field(doc, 'text').type, 'textarea');
});

test('a string with no declared ceiling is treated as prose', () => {
  const doc = recordDoc({
    key: 'tid',
    record: { type: 'object', properties: { body: { type: 'string' } } },
  });

  assert.equal(field(doc, 'body').type, 'textarea');
});

test('only arrays of plain strings get the tags control', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        langs: { type: 'array', items: { type: 'string', format: 'language' } },
        items: { type: 'array', items: { type: 'ref', ref: '#item' } },
      },
    },
  });

  assert.equal(field(doc, 'tags').type, 'tags');
  // A formatted string is not free text, so it keeps its JSON rather than
  // being flattened into a comma-separated box.
  assert.equal(field(doc, 'langs').type, 'json');
  assert.equal(field(doc, 'items').type, 'json');
});

test('structural fields fall back to JSON and say what belongs there', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        subject: { type: 'ref', ref: 'com.atproto.repo.strongRef' },
        embed: { type: 'union', refs: ['app.bsky.embed.images', 'app.bsky.embed.external'] },
        avatar: { type: 'blob', accept: ['image/png', 'image/jpeg'] },
      },
    },
  });

  assert.equal(field(doc, 'subject').type, 'json');
  assert.match(field(doc, 'subject').hint ?? '', /com\.atproto\.repo\.strongRef/);
  assert.match(field(doc, 'embed').hint ?? '', /app\.bsky\.embed\.images/);
  assert.match(field(doc, 'avatar').hint ?? '', /image\/png/);
});

test("the author's description leads the hint", () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        subject: { type: 'ref', ref: '#thing', description: 'What this points at.' },
      },
    },
  });

  assert.equal(field(doc, 'subject').hint, 'What this points at. · Object matching #thing');
});

test('required fields sort ahead of optional ones', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      required: ['name'],
      properties: {
        description: { type: 'string', maxLength: 100 },
        avatar: { type: 'blob' },
        name: { type: 'string', maxLength: 64 },
      },
    },
  });

  assert.equal(fieldsOf(doc)[0].key, 'name');
});

test('the record key type decides the key field', () => {
  const selfKeyed = formFromLexiconDocument(
    'com.example.thing',
    recordDoc({ key: 'literal:self', record: { type: 'object', properties: { a: { type: 'string' } } } }),
  );
  assert.equal(selfKeyed.ok, true);
  if (selfKeyed.ok) {
    assert.equal(selfKeyed.lexicon.rkeyMode, 'fixed');
    assert.equal(selfKeyed.lexicon.rkeyDefault, 'self');
  }

  const anyKeyed = formFromLexiconDocument(
    'com.example.thing',
    recordDoc({ key: 'any', record: { type: 'object', properties: { a: { type: 'string' } } } }),
  );
  assert.equal(anyKeyed.ok, true);
  // `any` means the author names it, so the field is offered and left empty.
  if (anyKeyed.ok) {
    assert.equal(anyKeyed.lexicon.rkeyMode, 'fixed');
    assert.equal(anyKeyed.lexicon.rkeyDefault, undefined);
  }

  const tidKeyed = formFromLexiconDocument(
    'com.example.thing',
    recordDoc({ key: 'tid', record: { type: 'object', properties: { a: { type: 'string' } } } }),
  );
  assert.equal(tidKeyed.ok, true);
  if (tidKeyed.ok) assert.equal(tidKeyed.lexicon.rkeyMode, 'tid');
});

test('$type is not a field the author fills in', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: { $type: { type: 'string' }, name: { type: 'string', maxLength: 10 } },
    },
  });

  assert.deepEqual(
    fieldsOf(doc).map((f) => f.key),
    ['name'],
  );
});

test('a lexicon that is not a record says so instead of half-building a form', () => {
  const query = {
    lexicon: 1,
    id: 'com.example.getThing',
    defs: { main: { type: 'query', parameters: {} } },
  };
  const result = formFromLexiconDocument('com.example.getThing', query);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /query lexicon, not a record type/);
});

test('documents with nothing to build from are reported, not thrown on', () => {
  for (const doc of [null, 'nope', {}, { defs: {} }, recordDoc({ key: 'tid' })]) {
    const result = formFromLexiconDocument('com.example.thing', doc);
    assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(doc)}`);
  }
});

test('a property that is not an object is skipped rather than rendered empty', () => {
  assert.equal(fieldFromProperty('broken', 'not an object', false), null);
});

test('labels come from the property name', () => {
  assert.equal(labelForProperty('displayName'), 'Display name');
  assert.equal(labelForProperty('createdAt'), 'Created at');
  assert.equal(labelForProperty('profileURI'), 'Profile URI');
  assert.equal(labelForProperty('text'), 'Text');
});

test('a formatted string is a single-line field, not prose', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: {
        // No maxLength anywhere, which is the case the old rule got wrong:
        // a DID in a four-row textarea.
        did: { type: 'string', format: 'did' },
        subject: { type: 'string', format: 'at-uri' },
        prose: { type: 'string' },
      },
    },
  });

  assert.equal(field(doc, 'did').type, 'text');
  assert.equal(field(doc, 'subject').type, 'text');
  assert.equal(field(doc, 'prose').type, 'textarea');
});

test('a ref into the same document is followed to its scalar', () => {
  const doc = {
    lexicon: 1,
    id: 'com.example.thing',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          required: ['purpose'],
          properties: {
            purpose: { type: 'ref', ref: '#purpose', description: 'What this list is for.' },
            // The long spelling of the same thing resolves identically.
            other: { type: 'ref', ref: 'com.example.thing#purpose' },
          },
        },
      },
      purpose: {
        type: 'string',
        knownValues: ['curate', 'mod'],
        description: 'One of the known purposes.',
      },
    },
  };

  const purpose = field(doc, 'purpose');
  assert.equal(purpose.type, 'select');
  assert.deepEqual(purpose.options, ['curate', 'mod']);
  assert.equal(purpose.openOptions, true);
  // Both descriptions survive: the property says why, the def says what.
  assert.equal(purpose.hint, 'What this list is for. One of the known purposes.');

  assert.equal(field(doc, 'other').type, 'select');
});

test('a ref to another lexicon keeps its JSON', () => {
  const doc = recordDoc({
    key: 'tid',
    record: {
      type: 'object',
      properties: { purpose: { type: 'ref', ref: 'app.bsky.graph.defs#listPurpose' } },
    },
  });

  assert.equal(field(doc, 'purpose').type, 'json');
});

test('a ref to a structure stays a structure', () => {
  const doc = {
    lexicon: 1,
    id: 'com.example.thing',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: { type: 'object', properties: { site: { type: 'ref', ref: '#site' } } },
      },
      site: { type: 'object', properties: { url: { type: 'string' } } },
    },
  };

  assert.equal(field(doc, 'site').type, 'json');
});

test('a ref cycle is refused rather than followed', () => {
  const doc = {
    lexicon: 1,
    id: 'com.example.thing',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: { type: 'object', properties: { a: { type: 'ref', ref: '#loop' } } },
      },
      loop: { type: 'ref', ref: '#loop' },
    },
  };

  assert.equal(field(doc, 'a').type, 'json');
});

test('an array of locally-refd plain strings still gets the tags control', () => {
  const doc = {
    lexicon: 1,
    id: 'com.example.thing',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: {
          type: 'object',
          properties: {
            tags: { type: 'array', items: { type: 'ref', ref: '#tag' } },
            kinds: { type: 'array', items: { type: 'ref', ref: '#kind' } },
          },
        },
      },
      tag: { type: 'string', maxLength: 64 },
      // A named set of values is a list of choices, not free text, so it is
      // not flattened into a comma-separated box that would lose them.
      kind: { type: 'string', knownValues: ['a', 'b'] },
    },
  };

  assert.equal(field(doc, 'tags').type, 'tags');
  assert.equal(field(doc, 'kinds').type, 'json');
});

test('bounds come from the def a ref led to', () => {
  const doc = {
    lexicon: 1,
    id: 'com.example.thing',
    defs: {
      main: {
        type: 'record',
        key: 'tid',
        record: { type: 'object', properties: { name: { type: 'ref', ref: '#name' } } },
      },
      name: { type: 'string', maxLength: 64 },
    },
  };

  assert.equal(field(doc, 'name').type, 'text');
  assert.equal(field(doc, 'name').maxLength, 64);
});
