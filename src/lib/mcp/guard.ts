/**
 * Host validation for MCP tools that fetch anything not hard-coded in
 * src/utils/atproto/config.ts. That covers caller-supplied hostnames
 * (describe_pds) and PDS endpoints resolved from DID documents, which are
 * author-controlled and can point anywhere — including at loopback or
 * link-local addresses this server must never fetch.
 */

import { isBlockedFetchHost } from '@/utils/ssrfGuard';
import { McpToolError } from '@/lib/mcp/errors';

/**
 * Normalize a host or URL to an https base URL with no trailing slash,
 * rejecting anything that is not a public http(s) target. `what` names the
 * value in the error ("The host", "The resolved PDS endpoint").
 */
export function assertPublicServiceBase(input: string, what: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new McpToolError('invalid_parameter', `${what} is not a valid host or URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new McpToolError('invalid_parameter', `${what} must be an http(s) target`);
  }
  if (isBlockedFetchHost(url.hostname)) {
    throw new McpToolError(
      'invalid_parameter',
      `${what} points at a private or internal address`,
      'Only public hosts can be fetched from this server.',
    );
  }
  return url.origin;
}
