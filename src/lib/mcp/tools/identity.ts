/**
 * Identity tools: who is this account, and how did it get here.
 *
 * This file is the reference implementation for the tool-group pattern:
 * zod input schema with bounded strings, a dispatch-criteria description
 * ("you have X and need Y"), READ_ONLY annotations, toolHandler() wrapping,
 * McpToolError for anticipated failures, and a links block on every success.
 */

import { z } from 'zod';
import { URL } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/server';
import { getPlcAuditLog, diffOps, type PlcOperation } from '@/utils/atproto/plc';
import { resolveGuardedIdentity } from '@/lib/mcp/identityResolve';
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, profileLink, exploreLink, READ_ONLY } from '@/lib/mcp/respond';

const identifierSchema = z
  .string()
  .min(1)
  .max(2048)
  .describe(
    'A handle (alice.bsky.social), a DID (did:plc:… or did:web:…), or an at:// URI whose repo segment is used.',
  );

/** Audit logs are usually short; the cap only guards pathological repos. */
const MAX_AUDIT_ENTRIES = 100;
const MAX_BATCH_IDENTITIES = 100;
const BATCH_CONCURRENCY = 4;
/** Leave time for the MCP tool's 25-second outer budget to serialize the result. */
const BATCH_BUDGET_MS = 18_000;

type BatchResult =
  | { did: string; handle: string | null; pdsHost: string; createdAt: string | null; status: 'resolved'; historyError?: string }
  | { status: 'unresolved'; error: string };
type BatchIdentity = { input: string } & BatchResult;

/** Keep the lookup dependencies injectable so batch behavior can be tested without network access. */
export async function resolveIdentitiesBatch(
  identifiers: string[],
  resolve: typeof resolveGuardedIdentity = resolveGuardedIdentity,
  audit: typeof getPlcAuditLog = getPlcAuditLog,
  budgetMs = BATCH_BUDGET_MS,
): Promise<{ requested: number; resolved: number; unresolved: number; identities: BatchIdentity[] }> {
  if (identifiers.length < 1 || identifiers.length > MAX_BATCH_IDENTITIES) {
    throw new McpToolError('invalid_parameter', `Pass 1 to ${MAX_BATCH_IDENTITIES} identifiers`);
  }

  const results = new Array<BatchIdentity>(identifiers.length);
  const pending = new Map<string, Promise<BatchResult>>();
  let next = 0;
  let rateLimited = false;
  let expired = false;

  async function lookup(input: string): Promise<BatchResult> {
    if (!/^did:(plc|web):\S+$/.test(input)) {
      return { status: 'unresolved', error: 'Expected a did:plc or did:web identifier' };
    }
    try {
      const bundle = await resolve(input);
      let createdAt: string | null = null;
      let historyError: string | undefined;
      if (bundle.did.startsWith('did:plc:')) {
        try {
          const log = await audit(bundle.did);
          const first = log[0]?.createdAt;
          if (first && !Number.isNaN(Date.parse(first))) createdAt = first;
        } catch (err) {
          if (err instanceof Error && /^HTTP 429\b/.test(err.message)) {
            rateLimited = true;
            historyError = 'PLC audit log rate limited this batch; retry later';
          } else {
            historyError = 'PLC audit log unavailable';
          }
        }
      }
      return {
        did: bundle.did,
        handle: bundle.handle,
        pdsHost: new URL(bundle.pds).hostname,
        createdAt,
        status: 'resolved',
        ...(historyError ? { historyError } : {}),
      };
    } catch (err) {
      if (err instanceof McpToolError) return { status: 'unresolved', error: err.message };
      if (err instanceof Error && /^HTTP 429\b/.test(err.message)) {
        rateLimited = true;
        return { status: 'unresolved', error: 'Upstream rate limited this batch; retry later' };
      }
      return { status: 'unresolved', error: 'An upstream identity service failed or timed out' };
    }
  }

  async function worker(): Promise<void> {
    while (!expired && next < identifiers.length) {
      const index = next++;
      const input = identifiers[index];
      if (rateLimited) {
        results[index] = { input, status: 'unresolved', error: 'Upstream rate limited this batch; retry later' };
        continue;
      }
      const key = input.trim();
      let work = pending.get(key);
      if (!work) {
        work = lookup(key);
        pending.set(key, work);
      }
      const value = await work;
      if (!expired) results[index] = { input, ...value };
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, identifiers.length) }, () => worker())),
      new Promise<void>((done) => { timer = setTimeout(done, budgetMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
  expired = true;
  const identities = Array.from({ length: identifiers.length }, (_, index) => results[index] ?? {
    input: identifiers[index], status: 'unresolved' as const,
    error: 'Batch time limit reached; retry this identifier',
  });
  const resolved = identities.filter((result) => result.status === 'resolved').length;
  return { requested: identifiers.length, resolved, unresolved: identifiers.length - resolved, identities };
}

/**
 * Accounts created before the v2 PLC operation format record their handle and
 * PDS as top-level strings (`handle`, `service`) instead of `alsoKnownAs` and
 * `services`. Reading only the modern shape drops the original handle and
 * host for every account made in 2022, which is exactly the history someone
 * asks this tool about.
 */
type LegacyPlcFields = { handle?: string; service?: string };

function handlesOf(operation: PlcOperation & LegacyPlcFields): string[] {
  if (operation.alsoKnownAs?.length) return operation.alsoKnownAs;
  return operation.handle ? [`at://${operation.handle}`] : [];
}

function pdsOf(operation: PlcOperation & LegacyPlcFields): string | null {
  return operation.services?.atproto_pds?.endpoint ?? operation.service ?? null;
}

export function registerIdentityTools(server: McpServer): void {
  server.registerTool(
    'resolve_identity',
    {
      title: 'Resolve an atproto identity',
      description:
        'You have an atproto handle, DID, or at:// URI and need the canonical identity behind it: ' +
        'the DID, the current handle, the PDS host where the repo lives, and the DID document ' +
        'summary (alsoKnownAs, declared services). Start here when a later tool needs a DID or a PDS.',
      inputSchema: z.object({ identifier: identifierSchema }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ identifier }) => {
      const bundle = await resolveGuardedIdentity(identifier);
      return {
        did: bundle.did,
        handle: bundle.handle,
        pds: bundle.pds,
        didDoc: {
          alsoKnownAs: bundle.alsoKnownAs,
          services: bundle.services,
        },
        links: {
          profile: profileLink(bundle.handle ?? bundle.did),
          explore: exploreLink(`/${bundle.handle ?? bundle.did}`),
        },
      };
    }),
  );

  server.registerTool(
    'resolve_identities',
    {
      title: 'Resolve up to 100 atproto identities',
      description:
        'You have 1 to 100 did:plc or did:web identifiers and need their current handles, PDS hosts, ' +
        'and PLC creation times in one call. Returns one result per input, including duplicates and failures, ' +
        'with requested/resolved/unresolved counts. createdAt is null for did:web or when PLC history ' +
        'is unavailable; historyError explains failed PLC lookups. PLC rate limits or the 18-second ' +
        'batch deadline stop new lookups and mark unfinished inputs unresolved.',
      inputSchema: z.object({
        identifiers: z.array(z.string().min(1).max(256)).min(1).max(MAX_BATCH_IDENTITIES)
          .describe('1 to 100 did:plc or did:web identifiers; duplicates are returned in input order.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ identifiers }) => resolveIdentitiesBatch(identifiers)),
  );

  server.registerTool(
    'get_identity_history',
    {
      title: 'Identity history from the PLC audit log',
      description:
        'You have an account and want its identity timeline: when it was created, every handle it ' +
        'has used, PDS migrations, and key rotations, from the PLC directory audit log. Only ' +
        'did:plc accounts have one; did:web identities are rejected with a hint.',
      inputSchema: z.object({ identifier: identifierSchema }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ identifier }) => {
      const bundle = await resolveGuardedIdentity(identifier);

      if (!bundle.did.startsWith('did:plc:')) {
        throw new McpToolError(
          'invalid_parameter',
          `${bundle.did} is not a did:plc identity, so it has no PLC audit log`,
          'did:web history lives in the domain itself (DNS and /.well-known/did.json), which is not versioned.',
        );
      }

      const log = await getPlcAuditLog(bundle.did);
      const recent = log.slice(-MAX_AUDIT_ENTRIES);
      const operations = recent.map((entry, i) => {
        const prev = i === 0 ? (log.length > recent.length ? log[log.length - recent.length - 1] : undefined) : recent[i - 1];
        return {
          createdAt: entry.createdAt,
          cid: entry.cid ?? null,
          nullified: entry.nullified ?? false,
          changes:
            !prev && log[0] === entry
              ? ['identity created']
              : diffOps(prev?.operation, entry.operation),
          handles: handlesOf(entry.operation),
          pds: pdsOf(entry.operation),
        };
      });

      return {
        did: bundle.did,
        handle: bundle.handle,
        totalOperations: log.length,
        truncated: log.length > operations.length,
        operations,
        links: {
          auditLog: `https://plc.directory/${encodeURIComponent(bundle.did)}/log/audit`,
          explore: exploreLink(`/${bundle.handle ?? bundle.did}`),
        },
      };
    }),
  );
}
