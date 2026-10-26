import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  API_ERROR_CODES,
  DOCUMENTED_API_PATHS,
  buildOpenApiDocument,
} from '@/lib/openapi';

const doc = buildOpenApiDocument('https://example.test');
const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
  Object.entries(methods as Record<string, Record<string, unknown>>).map(
    ([method, op]) => ({ path, method, op }),
  ),
);

test('is a well-formed OpenAPI 3.1 document', () => {
  assert.equal(doc.openapi, '3.1.0');
  assert.ok(doc.info.title);
  assert.ok(doc.info.version);
  assert.deepEqual(doc.servers, [
    { url: 'https://example.test', description: 'Production' },
  ]);
});

test('the base URL is normalised, never doubling the slash', () => {
  const trailing = buildOpenApiDocument('https://example.test/');
  assert.equal(trailing.servers[0].url, 'https://example.test');
  assert.equal(trailing.info.contact.url, 'https://example.test/contact');
});

test('every documented path has a route handler on disk', () => {
  // The likeliest way this document rots is an endpoint being renamed or
  // deleted without the spec following.
  for (const path of DOCUMENTED_API_PATHS) {
    assert.ok(
      existsSync(resolve(process.cwd(), `src/app${path}/route.ts`)),
      `${path} is documented but has no route handler`,
    );
    assert.ok(path in doc.paths, `${path} is in DOCUMENTED_API_PATHS but not in paths`);
  }
  assert.equal(Object.keys(doc.paths).length, DOCUMENTED_API_PATHS.length);
});

test('operationIds are present and unique', () => {
  // Function-calling bridges key tool names off operationId; a duplicate
  // silently shadows one of the endpoints.
  const ids = operations.map(({ op }) => op.operationId);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
});

test('every operation carries a summary, a description and a tag', () => {
  for (const { path, method, op } of operations) {
    const where = `${method.toUpperCase()} ${path}`;
    assert.ok(op.summary, `${where} has no summary`);
    assert.ok(op.description, `${where} has no description`);
    assert.ok(Array.isArray(op.tags) && op.tags.length > 0, `${where} has no tags`);
  }
});

test('every parameter is typed and described', () => {
  for (const { path, op } of operations) {
    for (const param of (op.parameters ?? []) as Record<string, unknown>[]) {
      assert.ok(param.schema, `${path} parameter ${param.name} has no schema`);
      assert.ok(param.description, `${path} parameter ${param.name} has no description`);
      assert.equal(param.in, 'query');
    }
  }
});

type ResponseObject = {
  description?: string;
  content?: Record<string, { schema?: unknown }>;
};

test('every response has a description and a JSON schema', () => {
  for (const { path, op } of operations) {
    const responses = op.responses as Record<string, ResponseObject>;
    assert.ok(Object.keys(responses).length > 0, `${path} documents no responses`);
    for (const [status, response] of Object.entries(responses)) {
      assert.ok(response.description, `${path} ${status} has no description`);
      const json = response.content?.['application/json'];
      assert.ok(json?.schema, `${path} ${status} has no application/json schema`);
    }
  }
});

test('every $ref resolves to a defined component schema', () => {
  const schemas = doc.components.schemas as Record<string, unknown>;
  const refs = new Set<string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') refs.add(value);
      else walk(value);
    }
  };
  walk(doc);

  assert.ok(refs.size > 0);
  for (const ref of refs) {
    const name = ref.replace('#/components/schemas/', '');
    assert.ok(name in schemas, `${ref} has no matching component schema`);
  }
});

test('the documented error codes match the ApiErrorCode union exactly', () => {
  // apiError.ts is the runtime source; this document restates the set for
  // consumers. They drift the moment someone adds a code to one only.
  const source = readFileSync(resolve(process.cwd(), 'src/lib/apiError.ts'), 'utf8');
  const union = source.slice(
    source.indexOf('export type ApiErrorCode'),
    source.indexOf('export type ApiErrorBody'),
  );
  const declared = [...union.matchAll(/\|\s*'([a-z_]+)'/g)].map(m => m[1]);

  const documented: readonly string[] = doc.components.schemas.ApiError.properties.code.enum;
  assert.deepEqual([...declared].sort(), [...API_ERROR_CODES].sort());
  assert.deepEqual([...documented].sort(), [...declared].sort());
});

test('the ApiError schema requires a code and a message', () => {
  const required: readonly string[] = doc.components.schemas.ApiError.required;
  for (const field of ['ok', 'code', 'error']) assert.ok(required.includes(field));
  // `hint` is optional by design: its presence means there is a concrete fix.
  assert.ok(!required.includes('hint'));
});
