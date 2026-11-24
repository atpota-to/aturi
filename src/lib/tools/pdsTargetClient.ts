/**
 * Settling what was typed into a PDS host, for the tools that are about a
 * host and take an account as a way of naming one: the relay crawl check and
 * the PDS version check. What the input may be is read in relay.ts
 * (normalizeRelayInput); this makes the requests.
 *
 * All of them answer a browser directly: the host itself, and Slingshot for
 * the account's PDS.
 */

import { describeServer, getServerHealth } from '@/utils/atproto/pdsServer';
import { resolveMiniDoc, type MiniDoc } from '@/utils/atproto/slingshot';
import { hostOfEndpoint, type PdsProbe, type RelayInput } from './relay';

/**
 * The host a tool is about, and how it was arrived at. `pds` is what the
 * host says for itself, undefined until it has been asked: the hostname is
 * published as soon as it is known, not after.
 */
export type PdsTarget = {
  host: string;
  /** The account the host was looked up from, when the input was not a host. */
  account: { did: string; handle: string | null } | null;
  pds?: PdsProbe;
};

export async function probePds(host: string): Promise<PdsProbe> {
  const [server, health] = await Promise.all([
    describeServer(host).catch(() => null),
    getServerHealth(host).catch(() => null),
  ]);
  return { reachable: server !== null, did: server?.did, version: health?.version };
}

/**
 * Settle what was typed into a hostname. A URL is a host and a DID or
 * @handle is an account. A bare domain can be either, so both are asked at
 * once: if it answers as a PDS it is one, and otherwise, if it resolves as a
 * handle, the account's PDS is used. A domain that does neither is still
 * taken as a host, since a PDS that is down is exactly what someone would
 * come here to look into.
 */
export async function resolvePdsTarget(
  input: Extract<RelayInput, { ok: true }>,
  signal: AbortSignal,
  publish: (target: PdsTarget) => void,
): Promise<PdsTarget> {
  const fromAccount = async (mini: MiniDoc | null, identifier: string): Promise<PdsTarget> => {
    const host = mini ? hostOfEndpoint(mini.pds) : null;
    if (!mini || !host) throw new Error(`${identifier} could not be resolved to an account with a PDS.`);
    const target: PdsTarget = { host, account: { did: mini.did, handle: mini.handle } };
    publish(target);
    return { ...target, pds: await probePds(host) };
  };

  if (input.kind === 'account') {
    return fromAccount(await resolveMiniDoc(input.identifier, signal), input.identifier);
  }
  if (input.kind === 'host') {
    publish({ host: input.host, account: null });
    return { host: input.host, account: null, pds: await probePds(input.host) };
  }
  const [pds, mini] = await Promise.all([probePds(input.host), resolveMiniDoc(input.host, signal)]);
  if (!pds.reachable && mini) return fromAccount(mini, input.host);
  return { host: input.host, account: null, pds };
}
