import { GRANULAR_SCOPES } from './scopes';

/**
 * Human text for the one OAuth failure this app can reliably explain.
 *
 * An authorization server checks every requested scope against the client
 * metadata document it fetched from us, with a plain string membership test,
 * and refuses the whole request naming the first token that isn't in it. The
 * reference PDS holds that document in memory for ten minutes, so for a few
 * minutes after this app declares a new permission, a server that fetched the
 * previous document rejects the very token the current one declares.
 *
 * That is a transient failure with two remedies, and the raw message names
 * neither: it reads as a permanent misconfiguration, which is what it would be
 * at any other time. So the message is rewritten to say which permission was
 * refused, that waiting fixes it, and that unticking it signs you in now.
 *
 * Anything else is passed through untouched. A message we can't place is more
 * useful verbatim than paraphrased.
 */
export function describeSignInError(raw: string): string {
  const undeclared = raw.match(/Scope "([^"]+)" is not declared in the client metadata/);
  if (!undeclared) return raw;

  const token = undeclared[1];
  const label = GRANULAR_SCOPES.find((s) => s.scope === token)?.label;
  const named = label ? `“${label}”` : 'that permission';

  return (
    `Your server refused ${named}: it is holding an older copy of this app's ` +
    `permission list, which it caches for up to about ten minutes. Wait a few ` +
    `minutes and sign in again, or untick ${named} to sign in without it now.`
  );
}
