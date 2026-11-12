'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Binary, ExternalLink } from 'lucide-react';
import { toolHref } from '@/lib/tools/catalog';
import { claimMeaning, decodeIdentifier, isSensitiveInput, type Decoded } from '@/lib/tools/decode';
import { ToolEmpty, ToolFact, ToolFacts, ToolForm, ToolIntro, ToolJson, ToolSection, ToolShell, ToolCard } from './ToolFrame';
import { useToolQuery } from './useToolQuery';

const SLUG = 'decode';
const EXAMPLES = [
  { label: 'A record key', value: '3n22yg6lg2k2f' },
  { label: 'An at:// URI', value: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3n22yg6lg2k2f' },
  { label: 'A CID', value: 'bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq' },
  { label: 'A signing key', value: 'zQ3shQo6TF2moaqMTrUZEM1jeuYRQXeHEx4evX9751y2qPqRA' },
  { label: 'An NSID', value: 'app.bsky.feed.post' },
];

function DecodedLinks({ decoded }: { decoded: Decoded }) {
  if (!decoded.links?.length) return null;
  return (
    <div className="fn-tool-actions">
      {decoded.links.map((link) =>
        link.href.startsWith('/') ? (
          <Link key={link.href} href={link.href} prefetch={false} className="fx-btn fx-btn-sm">
            {link.label}
          </Link>
        ) : (
          <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="fx-btn fx-btn-sm">
            <ExternalLink size={13} aria-hidden /> {link.label}
          </a>
        ),
      )}
    </div>
  );
}

/** One reading of the input. A compound identifier nests its parts inside. */
function DecodedCard({ decoded, nested = false }: { decoded: Decoded; nested?: boolean }) {
  const body = (
    <>
      <p className="fn-tool-decode-summary">{decoded.summary}</p>
      <ToolFacts>
        {decoded.facts.map((fact) => {
          const meaning = decoded.kind === 'jwt' ? claimMeaning(fact.label) : null;
          return (
            <ToolFact
              key={fact.label}
              label={fact.label}
              copy={fact.copy ? fact.value : undefined}
              plain={fact.plain}
              wide={fact.value.length > 44}
            >
              {fact.value}
              {meaning ? <span className="fn-tool-decode-meaning">{meaning}</span> : null}
            </ToolFact>
          );
        })}
      </ToolFacts>
      {decoded.notes?.length ? (
        <ul className="fn-tool-decode-notes">
          {decoded.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
      {decoded.json?.map((block) => (
        <div key={block.label} className="fn-tool-decode-json">
          <span className="fn-dt">{block.label}</span>
          <ToolJson value={block.value} label={block.label.toLowerCase()} />
        </div>
      ))}
      {decoded.parts?.length ? (
        <div className="fn-tool-decode-parts">
          {decoded.parts.map((part) => (
            <section key={part.label} className="fn-tool-decode-part">
              <h3>
                <span>{part.label}</span>
                {part.decoded.title}
              </h3>
              <DecodedCard decoded={part.decoded} nested />
            </section>
          ))}
        </div>
      ) : null}
      <DecodedLinks decoded={decoded} />
    </>
  );
  return nested ? body : <ToolCard>{body}</ToolCard>;
}

/**
 * Takes an identifier apart in the browser. The reading itself is in
 * src/lib/tools/decode.ts.
 *
 * The input is kept in the link like every other tool's, with one exception:
 * a token, or anything long enough to be one, stays in this component's
 * state and never reaches the address bar.
 */
export default function IdentifierDecoder() {
  const [{ q }, setQuery] = useToolQuery(['q'] as const);
  const [held, setHeld] = useState('');
  // Read once, so "3 hours ago" does not shift between renders.
  const [now] = useState(() => Date.now());
  const input = held || q;
  const readings = input ? decodeIdentifier(input, now) : [];

  function submit(value: string) {
    if (isSensitiveInput(value)) {
      setHeld(value);
      setQuery({ q: '' }, { replace: true });
    } else {
      setHeld('');
      setQuery({ q: value });
    }
  }

  return (
    <ToolShell
      slug={SLUG}
      share={q && !held ? `${toolHref(SLUG)}?q=${encodeURIComponent(q)}` : undefined}
      form={
        <ToolForm
          value={input}
          onSubmit={submit}
          label="Identifier to decode"
          placeholder="A TID, CID, at:// URI, DID, NSID or token"
          submitLabel="Decode"
          examples={EXAMPLES}
          mono
          icon={<Binary size={17} />}
        />
      }
    >
      {input && readings.length === 0 && (
        <ToolEmpty>
          That does not read as a TID, CID, at:// URI, DID, key, NSID, handle, timestamp or token.
        </ToolEmpty>
      )}

      {readings.map((decoded) => (
        <ToolSection
          key={decoded.kind}
          title={decoded.title}
          meta={readings.length > 1 ? `One of ${readings.length} ways to read it` : undefined}
        >
          <DecodedCard decoded={decoded} />
        </ToolSection>
      ))}

      {held && (
        <p className="fn-tool-note">
          Tokens are decoded in this page and are not added to the link or sent anywhere.
        </p>
      )}

      {!input && (
        <ToolIntro
          title="What it reads"
          items={[
            {
              term: 'Record keys and revisions',
              text: 'A TID holds the microsecond it was made and a clock ID. A timestamp converts back to the TID for that instant.',
            },
            {
              term: 'Content identifiers',
              text: 'A CID’s version, codec and hash: whether it addresses a record or a blob, and the digest itself.',
            },
            {
              term: 'Addresses',
              text: (
                <>
                  An <code>at://</code> URI split into its authority, collection and record key, each decoded in
                  turn. DIDs by method, and NSIDs with the domain that publishes them.
                </>
              ),
            },
            {
              term: 'Keys and tokens',
              text: 'The curve behind a did:key or a DID document’s signing key, and the claims inside a session, OAuth or service token.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
