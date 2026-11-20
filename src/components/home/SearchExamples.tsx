'use client';

import Link from 'next/link';
import { Braces, MessageSquare, Server, User, type LucideIcon } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { useSessionProfile } from '@/components/useSessionProfile';
import { encodeRepo } from '@/utils/atproto/urls';
import { lexiconPathFor } from '@/utils/ufos/nsid';

type Example = {
  /** What the chip says. */
  label: string;
  /** Read before the label by screen readers, and shown on hover. */
  kind: string;
  /** Hover text, when the kind alone isn't the whole story. */
  title?: string;
  /** The label is words, not an identifier, so it leaves the mono face. */
  words?: boolean;
  href: string;
  Icon: LucideIcon;
};

/** Stands in for the visitor's own account until they sign in. */
const EXAMPLE_HANDLE = 'dame.is';

/**
 * The rest of the row: a record type, a server and a single record, so the
 * four chips between them cover each kind of place the explorer opens. The
 * post is shown by name rather than by its bsky.app URL, which is too long
 * for a chip; the URL is its hover text, since pasting one is the point.
 */
const EXAMPLES: Example[] = [
  {
    label: 'pub.leaflet.document',
    kind: 'Lexicon',
    href: lexiconPathFor('pub.leaflet.document'),
    Icon: Braces,
  },
  {
    label: 'eurosky.social',
    kind: 'PDS',
    href: '/explore/pds/eurosky.social',
    Icon: Server,
  },
  {
    label: 'Bluesky post',
    kind: 'Record',
    title: 'https://bsky.app/profile/dame.is/post/3mmd64ajqic2v',
    words: true,
    href: '/explore/dame.is/app.bsky.feed.post/3mmd64ajqic2v',
    Icon: MessageSquare,
  },
];

function Chip({ example, mine }: { example: Example; mine?: boolean }) {
  const { label, kind, title, words, href, Icon } = example;
  return (
    <Link
      href={href}
      prefetch={false}
      title={title ?? kind}
      className={mine ? 'fn-chip fn-chip-mine' : 'fn-chip'}
      data-words={words || undefined}
    >
      <Icon size={12} aria-hidden />
      <span className="fn-sr-only">{kind}: </span>
      {label}
    </Link>
  );
}

/**
 * "Try" chips under the homepage search box, one of each kind of thing it
 * looks up, as on the explorer's landing page (ExploreLanding.tsx).
 *
 * The account chip is the visitor's own once they're signed in. Until the
 * profile has loaded (and for an account whose handle doesn't verify) it
 * stays on the example handle, so the row never shows a bare DID that
 * would push the other chips onto another line and back.
 */
export default function SearchExamples() {
  const { did } = useAtprotoSession();
  const profile = useSessionProfile(did);
  const myHandle =
    profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null;

  const account: Example = {
    label: `@${myHandle ?? EXAMPLE_HANDLE}`,
    kind: myHandle ? 'Your repo' : 'Profile',
    href: `/explore/${encodeRepo(myHandle ?? EXAMPLE_HANDLE)}`,
    Icon: User,
  };

  return (
    <div className="fn-x-tries fn-home-tries">
      <span>Try</span>
      <Chip example={account} mine={Boolean(myHandle)} />
      {EXAMPLES.map((example) => (
        <Chip key={example.href} example={example} />
      ))}
    </div>
  );
}
