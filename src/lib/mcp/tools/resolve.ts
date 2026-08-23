/**
 * Resolve-and-open tools — the aturi-specific half of the catalog. These
 * wrap the same cores as /api/resolve and /api/waypoints (src/lib/
 * resolveLink.ts, src/lib/waypointCatalog.ts) so the REST and MCP answers
 * are always the same answer.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { resolveAtmosphereLink } from '@/lib/resolveLink';
import {
  buildWaypointCatalog,
  type WaypointCapability,
} from '@/lib/waypointCatalog';
import type { WaypointType } from '@/utils/waypoints.data';
import { McpToolError } from '@/lib/mcp/errors';
import { toolHandler, profileLink, recordLink, READ_ONLY } from '@/lib/mcp/respond';

export function registerResolveTools(server: McpServer): void {
  server.registerTool(
    'resolve_link',
    {
      title: 'Resolve any Atmosphere link',
      description:
        'You have a web URL (bsky.app, a Leaflet page, a Tangled repo, any Atmosphere client — or ' +
        'an arbitrary page that might declare AT Tags) or an at:// URI, and you want the record ' +
        'behind it plus every client that can open it, each with a ready URL. A page with no ' +
        'atproto data is a successful "resolved: false", not an error. Start here whenever the ' +
        'input is a link.',
      inputSchema: z.object({
        url: z
          .string()
          .min(1)
          .max(2048)
          .optional()
          .describe('A web page URL. Exactly one of url/atUri is required.'),
        atUri: z
          .string()
          .min(1)
          .max(2048)
          .optional()
          .describe('An at://<repo>/<collection>/<rkey> URI. Skips page detection.'),
        composeText: z
          .string()
          .min(1)
          .max(1000)
          .optional()
          .describe('Pre-fill text for the returned compose-intent links.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ url, atUri, composeText }) => {
      if (!url && !atUri) {
        throw new McpToolError(
          'missing_parameter',
          'Pass url or atUri',
          'A web page goes in url; an at:// identifier goes in atUri.',
        );
      }

      const result = await resolveAtmosphereLink({ url, atUri, composeText });

      if (result.kind === 'invalid') {
        throw new McpToolError(result.code, result.message, result.hint);
      }

      if (result.kind === 'no-data') {
        const { input, inputKind, isKnownHost, reason, message } = result.body;
        return { resolved: false, input, inputKind, isKnownHost, reason, message };
      }

      const {
        inputKind,
        detectedVia,
        source,
        isKnownHost,
        parsed,
        didResolved,
        recommended,
        waypoints,
      } = result.body;
      const actor = parsed.handle || parsed.did || '';
      const aturi =
        parsed.collection && parsed.rkey
          ? recordLink(actor, parsed.collection, parsed.rkey)
          : profileLink(actor);
      return {
        resolved: true,
        inputKind,
        detectedVia,
        source,
        isKnownHost,
        parsed,
        didResolved,
        recommended,
        waypoints,
        links: { aturi },
      };
    }),
  );

  server.registerTool(
    'list_waypoints',
    {
      title: 'The Atmosphere client catalog',
      description:
        'You want to know which Atmosphere clients exist and what each can do, with no record in ' +
        'hand: 25+ apps with the record types they render and whether they accept compose-intent ' +
        'links. Filter by type or capability. To get clients for a specific record, use ' +
        'resolve_link instead — it returns ready URLs.',
      inputSchema: z.object({
        type: z
          .enum(['post', 'profile', 'list', 'record'])
          .optional()
          .describe('Only clients that render this record type.'),
        capability: z
          .enum(['compose'])
          .optional()
          .describe('Only clients that accept a compose-intent link.'),
        composeText: z
          .string()
          .min(1)
          .max(1000)
          .optional()
          .describe('Pre-fill text for the returned compose-intent links.'),
      }),
      annotations: READ_ONLY,
    },
    toolHandler(async ({ type, capability, composeText }) => {
      const body = buildWaypointCatalog({
        type: (type as WaypointType) ?? null,
        capability: (capability as WaypointCapability) ?? null,
        composeText,
      });
      return { filters: body.filters, count: body.count, waypoints: body.waypoints };
    }),
  );
}
