/**
 * Identity tools: who is this account, and how did it get here.
 *
 * This file is the reference implementation for the tool-group pattern:
 * zod input schema with bounded strings, a dispatch-criteria description
 * ("you have X and need Y"), READ_ONLY annotations, toolHandler() wrapping,
 * McpToolError for anticipated failures, and a links block on every success.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { getPlcAuditLog, diffOps } from '@/utils/atproto/plc';
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

export function registerIdentityTools(server: McpServer): void {
  server.registerTool(
    'resolve_identity',
    {
      title: 'Resolve an atproto identity',
      description:
        'You have an atproto handle, DID, or at:// URI and need the canonical identity behind it: ' +
        'the DID, the current handle, and the PDS host where the repo lives. For did:plc accounts ' +
        'also returns the DID document summary (alsoKnownAs, declared services). Start here when a ' +
        'later tool needs a DID or a PDS.',
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
          handles: entry.operation.alsoKnownAs ?? [],
          pds: entry.operation.services?.atproto_pds?.endpoint ?? null,
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
