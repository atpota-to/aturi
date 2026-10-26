import { getSiteUrl } from '@/lib/config';

/**
 * OpenAPI 3.1 description of the public JSON API.
 *
 * Served at /openapi.json. This is the machine-readable twin of /docs — the
 * file an agent fetches to learn the API surface without reading prose, and
 * the one LLM function-calling bridges convert straight into tool definitions.
 * That second use is why every operation carries a unique `operationId`, a
 * `summary` short enough to be a tool name's description, typed parameters,
 * and a response schema: a bridge that can't find those emits an untyped tool
 * the model then calls wrong.
 *
 * Kept hand-written rather than generated. The routes are plain Next.js
 * handlers with no schema layer to derive from, so a generator would need one
 * introduced first — and there are five endpoints. The tradeoff is that this
 * file has to be edited alongside the handlers; the contract tests in
 * src/lib/__tests__ check the parts that can drift silently (operationId
 * uniqueness, every documented path existing as a route, the error-code enum
 * matching ApiErrorCode).
 *
 * 3.1 rather than 3.0 because it is a strict superset of JSON Schema 2020-12:
 * a nullable field is `type: ['string', 'null']` here, not the 3.0-only
 * `nullable: true` keyword.
 */

/** Version of the API surface this document describes, not of the site. */
export const OPENAPI_API_VERSION = '1.0.0';

/**
 * The set of paths this document describes. Exported so a test can assert each
 * one has a matching route handler on disk.
 */
export const DOCUMENTED_API_PATHS = [
  '/api/resolve',
  '/api/waypoints',
  '/api/at-tags',
  '/api/did-doc',
  '/api/oembed',
] as const;

const WAYPOINT_TYPE_ENUM = ['post', 'profile', 'list', 'record', 'unknown'];

/** Mirrors ApiErrorCode in src/lib/apiError.ts; a test keeps the two in step. */
export const API_ERROR_CODES = [
  'missing_parameter',
  'invalid_parameter',
  'unsupported_format',
  'not_found',
  'upstream_error',
  'internal_error',
] as const;

function errorResponse(description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ApiError' },
      },
    },
  };
}

export function buildOpenApiDocument(baseUrl: string = getSiteUrl()) {
  const origin = baseUrl.replace(/\/$/, '');

  return {
    openapi: '3.1.0',
    info: {
      title: 'aturi.to Public API',
      version: OPENAPI_API_VERSION,
      summary: 'Resolve any Atmosphere link into an AT URI and the clients that can open it.',
      description: [
        'A read-only, keyless HTTP API over the atproto ("Atmosphere") network.',
        '',
        'It answers three questions:',
        '',
        '1. **What atproto record is this web page?** — `resolveAtmosphereLink` turns a',
        '   URL from a share sheet (bsky.app, Leaflet, Tangled, pdsls, …) into the',
        '   `at://` URI behind it, by URL pattern first and by reading the page\'s own',
        '   AT Tags second.',
        '2. **Where else can I open this record?** — the same operation returns every',
        '   client that renders that record type, each with a ready-to-open URL.',
        '3. **What clients exist at all?** — `listWaypoints` returns the catalog with',
        '   no record needed, filterable by record type and by capability.',
        '',
        'No API key, no account, no rate-limit registration. Every operation is a GET,',
        'is safe to retry, sends permissive CORS headers, and is cached at the edge.',
        'Be reasonable about volume; there is no paid tier to upgrade to.',
      ].join('\n'),
      contact: {
        name: 'aturi.to',
        url: `${origin}/contact`,
        email: 'contact@aturi.to',
      },
      license: {
        name: 'GPL-3.0-or-later',
        identifier: 'GPL-3.0-or-later',
      },
    },
    servers: [{ url: origin, description: 'Production' }],
    externalDocs: {
      description: 'Developer docs (Markdown at /docs.md)',
      url: `${origin}/docs`,
    },
    tags: [
      { name: 'resolution', description: 'Turn a link or AT URI into a record and its destinations.' },
      { name: 'catalog', description: 'The waypoint catalog: which clients exist and what they render.' },
      { name: 'identity', description: 'atproto identity plumbing.' },
      { name: 'embeds', description: 'Rich-link previews.' },
    ],
    paths: {
      '/api/resolve': {
        get: {
          operationId: 'resolveAtmosphereLink',
          summary: 'Resolve a web URL or AT URI into a record and the clients that can open it',
          description: [
            'Give it either a page URL or an `at://` URI and it returns the parsed',
            'record plus every waypoint that can render it, each with a ready URL.',
            '',
            'Detection runs in two phases: URL-pattern matching against the known',
            'client catalog, then — unless `headDetect=false` — fetching the page and',
            'reading the AT Tags it declares about itself (`<meta name="at:canonical">`,',
            'then `at:alternate`, then a legacy `<link href="at://…">`).',
            '',
            'A page with no atproto record behind it is **not** an error: the response',
            'is HTTP 200 with `ok: false` and `reason: "no-atmosphere-data"`. Branch on',
            'the `ok` field, not on the status code.',
          ].join('\n'),
          tags: ['resolution'],
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: false,
              description: 'The page URL to resolve. Required unless `atUri` is given.',
              schema: { type: 'string', format: 'uri' },
              example: 'https://bsky.app/profile/aturi.to',
            },
            {
              name: 'atUri',
              in: 'query',
              required: false,
              description: 'An `at://` URI to use directly, skipping detection. Wins over `url` when both are sent.',
              schema: { type: 'string', pattern: '^at://' },
              example: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3k7qmjqrwl22g',
            },
            {
              name: 'composeText',
              in: 'query',
              required: false,
              description: 'Post text to pre-fill into every returned `composeIntent.url`.',
              schema: { type: 'string' },
            },
            {
              name: 'headDetect',
              in: 'query',
              required: false,
              description: 'Set to `false` to skip fetching the page for AT Tags when URL-pattern matching finds nothing. Faster, but resolves fewer links.',
              schema: { type: 'string', enum: ['false'] },
            },
          ],
          responses: {
            '200': {
              description: 'Resolution succeeded, or the page provably carries no atproto record.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/ResolveSuccess' },
                      { $ref: '#/components/schemas/ResolveNoMatch' },
                    ],
                  },
                },
              },
            },
            '400': errorResponse('Neither `url` nor `atUri` was supplied, or one of them was malformed.'),
          },
        },
      },

      '/api/waypoints': {
        get: {
          operationId: 'listWaypoints',
          summary: 'List the client catalog, optionally filtered by record type and capability',
          description: [
            'The whole waypoint catalog without needing a record to resolve first.',
            '`resolveAtmosphereLink` answers "where can I open *this*?"; this answers',
            '"what exists, and which of them can do X?".',
            '',
            'Every entry carries a `composeIntent` describing whether that client can be',
            'handed a link that opens its composer. `null` means "no confirmed route",',
            'which is not proof the client lacks one.',
          ].join('\n'),
          tags: ['catalog'],
          parameters: [
            {
              name: 'type',
              in: 'query',
              required: false,
              description: 'Only clients that render this record type. Omit for the whole catalog.',
              schema: { type: 'string', enum: WAYPOINT_TYPE_ENUM },
            },
            {
              name: 'capability',
              in: 'query',
              required: false,
              description: 'Only clients with a confirmed compose-intent route.',
              schema: { type: 'string', enum: ['compose'] },
            },
            {
              name: 'text',
              in: 'query',
              required: false,
              description: 'Post text to pre-fill into every returned `composeIntent.url`.',
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': {
              description: 'The filtered catalog.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/WaypointCatalog' },
                },
              },
            },
            '400': errorResponse('`type` or `capability` was outside its allowed set.'),
          },
        },
      },

      '/api/at-tags': {
        get: {
          operationId: 'readAtTags',
          summary: 'Read the AT Tags a web page declares about itself',
          description: [
            'Fetches a page and returns the AT Tags it publishes — the meta-tag',
            'convention by which an ordinary web page declares which atproto record it',
            'is. See https://tangled.org/chrisshank.com/at-tags/.',
            '',
            'A page with no AT Tags is a successful answer, not an error: `ok: true`',
            'with empty arrays and `primary: null`. A page that could not be fetched at',
            'all returns HTTP 200 with `ok: false` and `reason: "fetch-failed"`.',
            '',
            'The target is restricted to public http(s) hosts, and the read is bounded',
            'by both a timeout and a byte cap.',
          ].join('\n'),
          tags: ['resolution'],
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              description: 'Absolute http(s) URL of the page to inspect.',
              schema: { type: 'string', format: 'uri' },
            },
          ],
          responses: {
            '200': {
              description: 'The page was read, or provably could not be.',
              content: {
                'application/json': {
                  schema: {
                    oneOf: [
                      { $ref: '#/components/schemas/AtTagsSuccess' },
                      { $ref: '#/components/schemas/AtTagsFetchFailed' },
                    ],
                  },
                },
              },
            },
            '400': errorResponse('`url` was missing, malformed, or pointed at a non-public host.'),
          },
        },
      },

      '/api/did-doc': {
        get: {
          operationId: 'fetchDidWebDocument',
          summary: 'Fetch a did:web DID document through a CORS-safe proxy',
          description: [
            'Returns a `did:web` DID document verbatim. These documents are public but',
            'live on arbitrary hosts, most of which send no `Access-Control-Allow-Origin`',
            'header — so a browser can open one directly yet a cross-origin `fetch()`',
            'cannot read it. This proxies the read server-side.',
            '',
            'Constrained to https URLs whose path ends in `/did.json`, on routable',
            'public hosts, so it cannot be repurposed as a general-purpose proxy.',
          ].join('\n'),
          tags: ['identity'],
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              description: 'The document URL, e.g. `https://example.com/.well-known/did.json`.',
              schema: { type: 'string', format: 'uri' },
            },
          ],
          responses: {
            '200': {
              description: 'The DID document, passed through unmodified.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    description: 'A W3C DID document as served by the upstream host.',
                    additionalProperties: true,
                  },
                },
              },
            },
            '400': errorResponse('`url` was missing, unparseable, or not an allowed did:web document URL.'),
            '502': errorResponse('The upstream host errored, timed out, or was unreachable.'),
          },
        },
      },

      '/api/oembed': {
        get: {
          operationId: 'getPostOembed',
          summary: 'Get an oEmbed rich-preview payload for a Bluesky post',
          description: [
            'An oEmbed provider endpoint (https://oembed.com/) for post URLs, so',
            'rich-link previewers — notably Apple LinkPresentation in Messages and',
            'Mail — render a post-text-forward card instead of treating the author',
            'avatar as a hero image.',
          ].join('\n'),
          tags: ['embeds'],
          parameters: [
            {
              name: 'url',
              in: 'query',
              required: true,
              description: 'An aturi.to post URL or an `at://` post URI.',
              schema: { type: 'string' },
            },
            {
              name: 'format',
              in: 'query',
              required: false,
              description: 'Only `json` is implemented; `xml` returns 501.',
              schema: { type: 'string', enum: ['json'], default: 'json' },
            },
            {
              name: 'maxwidth',
              in: 'query',
              required: false,
              description: 'Requested embed width. Clamped to 220–550.',
              schema: { type: 'integer', minimum: 220, maximum: 550, default: 325 },
            },
          ],
          responses: {
            '200': {
              description: 'An oEmbed `rich` type response.',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/OembedRich' },
                },
              },
            },
            '400': errorResponse('`url` was missing.'),
            '404': errorResponse('The URL was not a recognised post URL, or the post does not exist.'),
            '500': errorResponse('Unexpected fault while building the payload.'),
            '501': errorResponse('A format other than `json` was requested.'),
          },
        },
      },
    },

    components: {
      schemas: {
        ApiError: {
          type: 'object',
          title: 'ApiError',
          description: 'The error body every public endpoint returns on failure.',
          required: ['ok', 'code', 'error'],
          properties: {
            ok: { type: 'boolean', const: false },
            code: {
              type: 'string',
              enum: [...API_ERROR_CODES],
              description: 'Stable machine-readable cause. Branch on this, not on `error`.',
            },
            error: { type: 'string', description: 'Human-readable message.' },
            hint: {
              type: 'string',
              description: 'Concrete next step. Present only when there is one.',
            },
          },
        },

        ComposeIntent: {
          type: 'object',
          title: 'ComposeIntent',
          description: 'How to open a client\'s composer via a link.',
          required: ['url', 'urlTemplate', 'textParam', 'prefillsText'],
          properties: {
            url: { type: 'string', format: 'uri', description: 'Ready to open; pre-filled when compose text was supplied and the client reads it.' },
            urlTemplate: { type: 'string', description: 'The same URL with a literal `{text}` placeholder.' },
            textParam: { type: ['string', 'null'], description: 'Query parameter carrying the text; null when the client ignores it.' },
            prefillsText: { type: 'boolean', description: 'False when the composer opens empty regardless of what you pass.' },
            appUrl: { type: 'string', description: 'Native-app deep link for the same intent, when the client publishes one.' },
          },
        },

        ResolvedWaypoint: {
          type: 'object',
          title: 'ResolvedWaypoint',
          description: 'One client that can open the resolved record.',
          required: ['id', 'name', 'category', 'url', 'composeIntent'],
          properties: {
            id: { type: 'string', description: 'Stable catalog id, e.g. `bsky`.' },
            name: { type: 'string' },
            category: { type: 'string' },
            url: { type: 'string', format: 'uri', description: 'Direct link to this record in that client.' },
            composeIntent: {
              oneOf: [
                { $ref: '#/components/schemas/ComposeIntent' },
                { type: 'null' },
              ],
            },
          },
        },

        ParsedRecord: {
          type: 'object',
          title: 'ParsedRecord',
          required: ['type', 'uri', 'handle', 'did', 'collection', 'rkey'],
          properties: {
            type: { type: 'string', enum: WAYPOINT_TYPE_ENUM },
            uri: { type: 'string', description: 'The `at://` URI.' },
            handle: { type: 'string' },
            did: { type: ['string', 'null'], description: 'Null when the handle could not be resolved.' },
            collection: { type: ['string', 'null'], description: 'NSID, e.g. `app.bsky.feed.post`.' },
            rkey: { type: ['string', 'null'] },
          },
        },

        ResolveSuccess: {
          type: 'object',
          title: 'ResolveSuccess',
          required: ['ok', 'inputKind', 'detectedVia', 'source', 'isKnownHost', 'parsed', 'didResolved', 'recommended', 'waypoints'],
          properties: {
            ok: { type: 'boolean', const: true },
            inputKind: { type: 'string', enum: ['atUri', 'url'] },
            detectedVia: {
              type: ['string', 'null'],
              enum: ['atUri', 'urlPattern', 'atTags', 'headLink', null],
              description: 'Which mechanism identified the record.',
            },
            source: { type: 'string', description: 'Catalog id of the client the input URL belongs to, or `headDetected`.' },
            isKnownHost: { type: 'boolean' },
            parsed: { $ref: '#/components/schemas/ParsedRecord' },
            didResolved: { type: 'boolean', description: 'True when the DID was looked up during this request.' },
            recommended: {
              type: 'object',
              required: ['ids', 'label'],
              properties: {
                ids: { type: 'array', items: { type: 'string' }, description: 'Catalog ids to surface first.' },
                label: { type: 'string' },
              },
            },
            waypoints: { type: 'array', items: { $ref: '#/components/schemas/ResolvedWaypoint' } },
          },
        },

        ResolveNoMatch: {
          type: 'object',
          title: 'ResolveNoMatch',
          description: 'HTTP 200. The input was valid but carries no atproto record.',
          required: ['ok', 'input', 'inputKind', 'isKnownHost', 'reason', 'message'],
          properties: {
            ok: { type: 'boolean', const: false },
            input: { type: 'string' },
            inputKind: { type: 'string', enum: ['atUri', 'url'] },
            isKnownHost: { type: 'boolean' },
            reason: { type: 'string', const: 'no-atmosphere-data' },
            message: { type: 'string' },
          },
        },

        CatalogWaypoint: {
          type: 'object',
          title: 'CatalogWaypoint',
          required: ['id', 'name', 'description', 'category', 'categoryName', 'supportedTypes', 'composeIntent'],
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            category: { type: 'string' },
            categoryName: { type: 'string' },
            supportedTypes: { type: 'array', items: { type: 'string', enum: WAYPOINT_TYPE_ENUM } },
            expectedCollections: {
              type: 'array',
              items: { type: 'string' },
              description: 'NSID prefixes this client renders; a trailing dot means a whole namespace.',
            },
            composeIntent: {
              oneOf: [
                { $ref: '#/components/schemas/ComposeIntent' },
                { type: 'null' },
              ],
            },
          },
        },

        WaypointCatalog: {
          type: 'object',
          title: 'WaypointCatalog',
          required: ['ok', 'filters', 'count', 'waypoints'],
          properties: {
            ok: { type: 'boolean', const: true },
            filters: {
              type: 'object',
              required: ['type', 'capability'],
              properties: {
                type: { type: ['string', 'null'], enum: [...WAYPOINT_TYPE_ENUM, null] },
                capability: { type: ['string', 'null'], enum: ['compose', null] },
              },
            },
            count: { type: 'integer', minimum: 0 },
            waypoints: { type: 'array', items: { $ref: '#/components/schemas/CatalogWaypoint' } },
          },
        },

        AtTagsSuccess: {
          type: 'object',
          title: 'AtTagsSuccess',
          required: ['ok', 'url', 'primary', 'tags', 'count'],
          properties: {
            ok: { type: 'boolean', const: true },
            url: { type: 'string', format: 'uri' },
            primary: {
              type: ['string', 'null'],
              description: 'The single record the page is about — canonical first, then alternate. Null when it declares none.',
            },
            tags: {
              type: 'object',
              required: ['canonical', 'alternate', 'author', 'me', 'namespaces'],
              properties: {
                canonical: { type: 'array', items: { type: 'string' } },
                alternate: { type: 'array', items: { type: 'string' } },
                author: { type: 'array', items: { type: 'string' } },
                me: { type: 'array', items: { type: 'string' } },
                namespaces: {
                  type: 'object',
                  description: 'Namespaced tags, keyed by namespace then relation.',
                  additionalProperties: {
                    type: 'object',
                    additionalProperties: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
            count: { type: 'integer', minimum: 0, description: 'Total AT Tags found.' },
          },
        },

        AtTagsFetchFailed: {
          type: 'object',
          title: 'AtTagsFetchFailed',
          description: 'HTTP 200. The URL was allowed but the page could not be read as HTML.',
          required: ['ok', 'url', 'reason', 'message'],
          properties: {
            ok: { type: 'boolean', const: false },
            url: { type: 'string', format: 'uri' },
            reason: { type: 'string', const: 'fetch-failed' },
            message: { type: 'string' },
          },
        },

        OembedRich: {
          type: 'object',
          title: 'OembedRich',
          description: 'An oEmbed 1.0 response of type `rich`.',
          required: ['type', 'version', 'provider_name', 'provider_url', 'html'],
          properties: {
            type: { type: 'string', const: 'rich' },
            version: { type: 'string', const: '1.0' },
            provider_name: { type: 'string' },
            provider_url: { type: 'string', format: 'uri' },
            cache_age: { type: 'integer' },
            width: { type: 'integer' },
            height: { type: ['integer', 'null'] },
            thumbnail_url: { type: 'string', format: 'uri' },
            thumbnail_width: { type: 'integer' },
            thumbnail_height: { type: 'integer' },
            html: { type: 'string', description: 'Embeddable HTML blockquote.' },
          },
        },
      },
    },
  };
}
