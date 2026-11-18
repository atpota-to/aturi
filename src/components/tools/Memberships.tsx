'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, List, LoaderCircle, User } from 'lucide-react';
import { Credit } from '@/components/explore/lexicons/primitives';
import { toolHref } from '@/lib/tools/catalog';
import {
  LIST_PAGE_SIZE,
  groupMemberships,
  membershipSummary,
  mergeMemberships,
  parseAccountInput,
  type Membership,
  type Verification,
} from '@/lib/tools/memberships';
import {
  loadAccount,
  loadListPage,
  loadVerifications,
  type Account,
  type ListPage,
  type VerificationList,
} from '@/lib/tools/membershipsClient';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';
import {
  ToolCard,
  ToolEmpty,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolForm,
  ToolIntro,
  ToolSection,
  ToolShell,
  ToolSkeleton,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'memberships';
const EXAMPLES = [{ value: 'bsky.app' }, { value: 'atproto.com' }, { value: 'aturi.to' }];

/** Verifications listed before the rest are folded behind "Show all". */
const VERIFICATIONS_SHOWN = 6;

/**
 * What the first run gathers. The account comes first; the two lookups then
 * run side by side, and either can fail without taking the other with it.
 */
type Result = {
  account: Account;
  lists?: ListPage | null;
  listsError?: string;
  verifications?: VerificationList | null;
  verificationsError?: string;
};

/** Pages of lists loaded after the first, for the account they belong to. */
type More = {
  key: string;
  items: Membership[];
  cursor: string | null;
  loading: boolean;
  error: string | null;
};

async function gather(actor: string, signal: AbortSignal, publish: (result: Result) => void): Promise<Result> {
  const account = await loadAccount(actor, signal);
  let result: Result = { account };
  const update = (patch: Partial<Result>) => {
    result = { ...result, ...patch };
    if (!signal.aborted) publish(result);
  };
  publish(result);

  const message = (err: unknown) => (err instanceof Error ? err.message : 'The lookup failed.');
  await Promise.all([
    loadListPage(account.did, null, signal).then(
      (lists) => update({ lists }),
      (err) => update({ lists: null, listsError: message(err) }),
    ),
    loadVerifications(account.did, account.considered, signal).then(
      (verifications) => update({ verifications }),
      (err) => update({ verifications: null, verificationsError: message(err) }),
    ),
  ]);
  return result;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? dateFormat.format(at) : null;
}

function Avatar({ src, square }: { src: string | null; square?: boolean }) {
  const shape = square ? 'square' : undefined;
  if (!src) {
    return (
      <span className="fn-tool-avatar fn-tool-memberships-blank" data-shape={shape} aria-hidden>
        {square ? <List size={15} /> : <User size={15} />}
      </span>
    );
  }
  // A plain <img>, as the typeahead draws its avatars: next/image would route
  // every list's avatar through the image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={32} height={32} loading="lazy" className="fn-tool-avatar" data-shape={shape} />;
}

function ListRow({ item }: { item: Membership }) {
  const added = formatDate(item.addedAt);
  if (!item.list) {
    return (
      <li className="fn-tool-row" data-quiet>
        <Avatar src={null} square />
        <div className="fn-tool-row-main">
          <span className="fn-tool-row-title">
            {item.listUri ? 'List no longer available' : 'Membership record could not be read'}
          </span>
          <span className="fn-tool-row-sub" data-mono>
            {item.listUri ?? item.itemUri}
          </span>
        </div>
        {added && <span className="fn-tool-row-end">Added {added}</span>}
      </li>
    );
  }
  const { list } = item;
  const curator = list.creator.handle ? `@${list.creator.handle}` : shortDid(list.creator.did);
  const size =
    list.memberCount === null ? null : `${list.memberCount.toLocaleString()} ${list.memberCount === 1 ? 'member' : 'members'}`;
  return (
    <li className="fn-tool-row">
      <Avatar src={list.avatar} square />
      <div className="fn-tool-row-main">
        <Link href={explorePathFromAtUri(list.uri) ?? '/explore'} prefetch={false} className="fn-tool-row-title">
          {list.name}
        </Link>
        <span className="fn-tool-row-sub">
          by{' '}
          <Link href={`/explore/${list.creator.did}`} prefetch={false}>
            {curator}
          </Link>
          {size && ` · ${size}`}
        </span>
        {list.description && <span className="fn-tool-memberships-desc">{list.description}</span>}
      </div>
      {added && <span className="fn-tool-row-end">Added {added}</span>}
    </li>
  );
}

const STANDING: Record<Verification['standing'], { word: string; tone: 'pass' | 'warn' | undefined; title: string }> = {
  valid: { word: 'Counts on Bluesky', tone: 'pass', title: 'From a trusted verifier, and still matches the account.' },
  stale: {
    word: 'No longer counts',
    tone: 'warn',
    title: 'From a trusted verifier, but the name or handle it vouched for has changed since.',
  },
  unlisted: {
    word: 'Not counted',
    tone: undefined,
    title: 'From a trusted verifier, but Bluesky does not count it for this account.',
  },
  untrusted: {
    word: 'Not a trusted verifier',
    tone: undefined,
    title: 'Anyone can write a verification record. Bluesky only shows those from verifiers it trusts.',
  },
};

function VerificationRow({ item }: { item: Verification }) {
  const name = item.issuer.displayName || (item.issuer.handle ? `@${item.issuer.handle}` : shortDid(item.issuer.did));
  const when = formatDate(item.createdAt);
  const as = [item.displayName ? `“${item.displayName}”` : null, item.handle ? `@${item.handle}` : null]
    .filter(Boolean)
    .join(', ');
  const standing = STANDING[item.standing];
  return (
    <li className="fn-tool-row">
      <Avatar src={item.issuer.avatar} />
      <div className="fn-tool-row-main">
        <Link href={`/explore/${item.issuer.did}`} prefetch={false} className="fn-tool-row-title">
          {name}
        </Link>
        <span className="fn-tool-row-sub">
          {as ? `Verified as ${as}` : 'Verified this account'}
          {when && ` · ${when}`}
        </span>
      </div>
      <span className="fn-tool-row-end">
        <span className="fn-tool-pill" data-tone={standing.tone} title={standing.title}>
          {standing.word}
        </span>
      </span>
    </li>
  );
}

function ListSection({ title, hint, items }: { title: string; hint: string; items: Membership[] }) {
  if (items.length === 0) return null;
  return (
    <ToolSection title={title} meta={`${items.length.toLocaleString()} loaded`}>
      <p className="fn-tool-note fn-tool-memberships-hint">{hint}</p>
      <ToolCard flush>
        <ul className="fn-tool-rows fn-tool-memberships-rows">
          {items.map((item) => (
            <ListRow key={item.itemUri} item={item} />
          ))}
        </ul>
      </ToolCard>
    </ToolSection>
  );
}

/**
 * Finds the lists an account is on and the accounts that have verified it.
 * The logic is in src/lib/tools/memberships.ts and the requests in
 * membershipsClient.ts; this runs them and draws the result.
 *
 * The first page of lists and the verifications load with the page. Further
 * pages of lists load on a button, since a well-known account is on tens of
 * thousands and each one takes two lookups to describe.
 */
export default function Memberships() {
  const [{ account: raw }, setQuery] = useToolQuery(['account'] as const);
  const input = raw ? parseAccountInput(raw) : null;
  const actor = input?.ok ? input.actor : null;

  const run = useToolRun<Result>(actor, ({ signal, publish }) => gather(actor as string, signal, publish));

  // Kept with the account it was loaded for, so a new account starts clean
  // without anything to reset.
  const [moreState, setMore] = useState<More | null>(null);
  const [showAll, setShowAll] = useState<string | null>(null);
  const more = moreState && moreState.key === actor ? moreState : null;

  const result = run.data;
  const account = result?.account ?? null;
  const first = result?.lists ?? null;
  const items = first ? mergeMemberships(first.items, more?.items ?? []) : [];
  const groups = groupMemberships(items);
  const cursor = more ? more.cursor : (first?.cursor ?? null);
  const listTotal = first?.total ?? null;
  const loadedRecords = (first?.items.length ?? 0) + (more?.items.length ?? 0);

  const verifications = result?.verifications ?? null;
  const allShown = showAll === actor;
  const shownVerifications = verifications
    ? allShown
      ? verifications.items
      : verifications.items.slice(0, VERIFICATIONS_SHOWN)
    : [];

  async function loadMore() {
    if (!account || !actor || !cursor) return;
    const key = actor;
    setMore((prev) => ({
      key,
      items: prev?.key === key ? prev.items : [],
      cursor,
      loading: true,
      error: null,
    }));
    try {
      const page = await loadListPage(account.did, cursor);
      setMore((prev) =>
        prev?.key === key
          ? { ...prev, items: [...prev.items, ...page.items], cursor: page.cursor, loading: false }
          : prev,
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : 'The next page could not be loaded.';
      setMore((prev) => (prev?.key === key ? { ...prev, loading: false, error } : prev));
    }
  }

  const who = account ? (account.handle ? `@${account.handle}` : shortDid(account.did)) : '';
  const settled = run.status === 'done' || (run.status === 'error' && Boolean(account));
  const standing = account
    ? account.verified
      ? 'Bluesky shows this account as verified.'
      : account.trustedVerifier
        ? 'Bluesky treats this account as a trusted verifier, which can verify others.'
        : account.onBluesky
          ? 'Bluesky does not show this account as verified.'
          : 'Bluesky’s AppView has no profile for this account, so only the records themselves are shown.'
    : '';

  return (
    <ToolShell
      slug={SLUG}
      share={actor ? `${toolHref(SLUG)}?account=${encodeURIComponent(actor)}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ account: value })}
          label="Account to look up"
          placeholder="Handle or DID"
          submitLabel="Look up"
          busy={run.status === 'loading'}
          examples={EXAMPLES}
          icon={<BadgeCheck size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {run.status === 'error' && !account && <ToolError onRetry={run.rerun}>{run.error}</ToolError>}

      {actor && !account && run.status === 'loading' && (
        <>
          <ToolVerdict tone="info" title={`Looking up ${actor}`} icon={<LoaderCircle size={18} className="fn-tool-spin" />}>
            Resolving the account.
          </ToolVerdict>
          <ToolSkeleton rows={4} />
        </>
      )}

      {account && (
        <>
          <ToolVerdict
            tone="info"
            title={
              settled
                ? `${who} ${membershipSummary(listTotal, verifications ? verifications.total : null)}`
                : `Looking up ${who}`
            }
            icon={settled ? <BadgeCheck size={18} /> : <LoaderCircle size={18} className="fn-tool-spin" />}
          >
            {settled ? standing : 'Asking Constellation which records point at this account.'}
          </ToolVerdict>

          <ToolSection
            title="Verifications"
            meta={verifications && verifications.total > 0 ? verifications.total.toLocaleString() : null}
          >
            {result?.verifications === undefined ? (
              <ToolSkeleton rows={2} />
            ) : result.verifications === null ? (
              <ToolError onRetry={run.rerun}>{result.verificationsError}</ToolError>
            ) : verifications && verifications.items.length > 0 ? (
              <>
                <ToolCard flush>
                  <ul className="fn-tool-rows fn-tool-memberships-rows">
                    {shownVerifications.map((item) => (
                      <VerificationRow key={item.uri} item={item} />
                    ))}
                  </ul>
                </ToolCard>
                {verifications.items.length > VERIFICATIONS_SHOWN && !allShown && (
                  <div className="fn-tool-memberships-more">
                    <button type="button" className="fn-btn" onClick={() => setShowAll(actor)}>
                      Show all {verifications.items.length.toLocaleString()}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <ToolEmpty>No account has published a verification of this one.</ToolEmpty>
            )}
          </ToolSection>

          {result?.lists === undefined ? (
            <ToolSection title="Lists">
              <ToolSkeleton rows={4} />
            </ToolSection>
          ) : result.lists === null ? (
            <ToolSection title="Lists">
              <ToolError onRetry={run.rerun}>{result.listsError}</ToolError>
            </ToolSection>
          ) : items.length === 0 ? (
            <ToolSection title="Lists">
              <ToolEmpty>No list includes this account.</ToolEmpty>
            </ToolSection>
          ) : (
            <>
              <ListSection
                title="Curation lists"
                hint="Lists people follow or build feeds from."
                items={groups.curate}
              />
              <ListSection
                title="Moderation lists"
                hint="Lists whose subscribers mute or block everyone on them."
                items={groups.mod}
              />
              <ListSection
                title="Starter packs"
                hint="The member list behind a starter pack."
                items={groups.reference}
              />
              <ListSection
                title="Unavailable lists"
                hint="The list was deleted, or the account behind it is gone. The index still counts the membership."
                items={groups.unavailable}
              />

              <div className="fn-tool-memberships-more">
                {cursor && (
                  <button type="button" className="fn-btn" onClick={loadMore} disabled={more?.loading}>
                    {more?.loading ? 'Loading…' : `Load ${LIST_PAGE_SIZE} more`}
                  </button>
                )}
                <span className="fn-tool-note" aria-live="polite">
                  {listTotal !== null
                    ? `${Math.min(loadedRecords, listTotal).toLocaleString()} of ${listTotal.toLocaleString()} memberships loaded, newest first`
                    : `${loadedRecords.toLocaleString()} memberships loaded, newest first`}
                </span>
              </div>
              {more?.error && <ToolError onRetry={loadMore}>{more.error}</ToolError>}
            </>
          )}

          <ToolSection title="Account">
            <ToolCard>
              <ToolFacts>
                <ToolFact label="Account" plain>
                  {account.displayName ? `${account.displayName} (${who})` : who}
                </ToolFact>
                <ToolFact label="DID" copy={account.did}>
                  {account.did}
                </ToolFact>
              </ToolFacts>
              <div className="fn-tool-actions">
                <Link href={`/explore/${account.did}`} prefetch={false} className="fx-btn fx-btn-sm">
                  Open in the Explorer
                </Link>
              </div>
            </ToolCard>
          </ToolSection>

          <Credit standalone />
        </>
      )}

      {!raw && (
        <ToolIntro
          title="What it finds"
          items={[
            {
              term: 'Lists that include the account',
              text: (
                <>
                  Every <code>app.bsky.graph.listitem</code> record that names it, wherever it was written,
                  with the list each one belongs to.
                </>
              ),
            },
            {
              term: 'What each list is for',
              text: 'Curation lists, moderation lists and the member lists behind starter packs are shown apart, with who made each one and how many are on it.',
            },
            {
              term: 'Who has verified it',
              text: (
                <>
                  Every <code>app.bsky.graph.verification</code> record that names it, and whether Bluesky
                  trusts the account that wrote it.
                </>
              ),
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
