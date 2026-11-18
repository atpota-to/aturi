'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Globe, ImageOff, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { explorePathFromAtUri } from '@/utils/atproto/urls';
import { toolHref } from '@/lib/tools/catalog';
import {
  buildPageChecks,
  declaredRecords,
  linkCardFor,
  normalizePageUrl,
  pageVerdict,
  type LinkCard,
  type PageCheck,
  type PageReport,
} from '@/lib/tools/page';
import { CheckList, type CheckItem } from './Checks';
import { ToolCard, ToolError, ToolForm, ToolIntro, ToolSection, ToolShell, ToolVerdict } from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'page';
const AT_TAGS_PROPOSAL = 'https://tangled.org/chrisshank.com/at-tags/';

/** One page that declares its record, one with a card and no record, one with neither. */
const EXAMPLES = [{ value: 'aturi.to/bsky.app' }, { value: 'atproto.com' }, { value: 'example.com' }];

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

function toItems(checks: PageCheck[]): CheckItem[] {
  return checks.map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line, index) => <div key={index}>{line}</div>),
    fix: check.fix?.map((line, index) => <p key={index}>{line}</p>),
  }));
}

/** A failure of the route itself is reported as `null`: "could not look". */
async function fetchReport(url: string, signal: AbortSignal): Promise<PageReport | null> {
  try {
    const res = await fetch(`/api/tools/page?url=${encodeURIComponent(url)}`, { signal });
    const body = (await res.json()) as ({ ok: true } & PageReport) | { ok: false };
    return body.ok ? body : null;
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
}

/**
 * The card as a client would draw it: the image over the title, the
 * description and the host. No client's own styling is copied; this is the
 * site's card with those four parts in it.
 *
 * The image is on someone else's server, so it is a plain <img> that sends
 * no referrer, and a failure to load is shown rather than left as a gap:
 * an image that does not load here will not load in a client either.
 */
function LinkCardPreview({ card }: { card: LinkCard }) {
  const [failed, setFailed] = useState<string | null>(null);
  const broken = card.image !== null && failed === card.image;
  return (
    <div className="fn-tool-page-card">
      {card.image && !broken && (
        // eslint-disable-next-line @next/next/no-img-element -- a third-party image, shown as fetched
        <img
          key={card.image}
          className="fn-tool-page-card-image"
          src={card.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(card.image)}
        />
      )}
      {broken && (
        <div className="fn-tool-page-card-broken" role="img" aria-label="The image did not load">
          <ImageOff size={20} aria-hidden />
          <span>The image did not load</span>
        </div>
      )}
      <div className="fn-tool-page-card-text">
        <strong>{card.title ?? card.host}</strong>
        {card.description && <p>{card.description}</p>}
        <span className="fn-tool-page-card-host">
          <Globe size={12} aria-hidden />
          {card.host}
        </span>
      </div>
    </div>
  );
}

const FIELDS: { label: string; read: (report: PageReport & { fetched: true }) => string | null }[] = [
  { label: 'og:title', read: (r) => r.meta.og.title },
  { label: 'og:description', read: (r) => r.meta.og.description },
  { label: 'og:image', read: (r) => r.meta.og.image },
  { label: 'og:site_name', read: (r) => r.meta.og.siteName },
  { label: 'og:type', read: (r) => r.meta.og.type },
  { label: 'og:url', read: (r) => r.meta.og.url },
  { label: 'twitter:card', read: (r) => r.meta.twitter.card },
  { label: 'twitter:title', read: (r) => r.meta.twitter.title },
  { label: 'twitter:description', read: (r) => r.meta.twitter.description },
  { label: 'twitter:image', read: (r) => r.meta.twitter.image },
  { label: '<title>', read: (r) => r.meta.title },
  { label: 'description', read: (r) => r.meta.description },
  { label: 'canonical', read: (r) => r.meta.canonical },
];

/**
 * Shows how a web page presents itself to the Atmosphere: the link card a
 * client would draw, and the at:// records the page declares. The reading is
 * in src/lib/tools/page.ts; this fetches the report and draws it.
 */
export default function PageChecker() {
  const [{ url: raw }, setQuery] = useToolQuery(['url'] as const);
  const input = raw ? normalizePageUrl(raw) : null;
  const url = input?.ok ? input.url : null;

  const run = useToolRun<PageReport | null>(url, ({ signal }) => fetchReport(url as string, signal));
  const report = run.status === 'loading' ? undefined : (run.data ?? null);
  const checks = url ? buildPageChecks(report) : [];
  const verdict = url ? pageVerdict(report, checks) : null;
  const reading = report && report.fetched ? report : null;
  const records = reading ? declaredRecords(reading) : [];
  const fields = reading
    ? FIELDS.map((field) => ({ label: field.label, value: field.read(reading) })).filter((field) => field.value)
    : [];

  return (
    <ToolShell
      slug={SLUG}
      share={url ? `${toolHref(SLUG)}?url=${encodeURIComponent(url)}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ url: value })}
          label="Address of the page to check"
          placeholder="https://example.com/post"
          busy={run.status === 'loading'}
          examples={EXAMPLES}
          icon={<Globe size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}

      {verdict && url && (
        <>
          <ToolVerdict
            tone={verdict.tone === 'pending' ? 'info' : verdict.tone}
            title={verdict.title}
            icon={VERDICT_ICON[verdict.tone]}
          >
            {verdict.text}
          </ToolVerdict>

          {reading && (
            <ToolSection title="Link card" meta="As a client would draw it">
              <LinkCardPreview card={linkCardFor(reading, reading.url)} />
            </ToolSection>
          )}

          <ToolSection
            title="Checks"
            meta={
              run.status === 'loading' ? (
                'Checking…'
              ) : (
                <button type="button" className="fn-tool-link" onClick={run.rerun}>
                  Check again
                </button>
              )
            }
          >
            <CheckList checks={toItems(checks)} label={`Checks for ${url}`} />
          </ToolSection>

          {reading && (
            <ToolSection
              title="Records this page declares"
              meta={records.length ? (records.length === 1 ? '1 URI' : `${records.length} URIs`) : undefined}
            >
              {records.length > 0 ? (
                <ToolCard flush>
                  <ul className="fn-tool-rows">
                    {records.map((record) => {
                      const path = explorePathFromAtUri(record.uri);
                      return (
                        <li key={`${record.name}:${record.uri}`} className="fn-tool-row fn-tool-page-record">
                          <div className="fn-tool-row-main">
                            {path ? (
                              <Link href={path} prefetch={false} rel="nofollow" className="fn-tool-row-title fn-tool-page-uri">
                                {record.uri}
                              </Link>
                            ) : (
                              <span className="fn-tool-row-title fn-tool-page-uri">{record.uri}</span>
                            )}
                            <span className="fn-tool-row-sub">{record.meaning}</span>
                          </div>
                          <span className="fn-tool-pill" data-tone={record.uri === reading.primary ? 'pass' : 'outline'}>
                            {record.name}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </ToolCard>
              ) : (
                <ToolCard>
                  <p>
                    None. A page that is a view of an atproto record can say so with a tag such as{' '}
                    <code>&lt;meta name=&quot;at:canonical&quot; content=&quot;at://…&quot;&gt;</code>, and tools
                    that are handed the link can then find the record.
                  </p>
                </ToolCard>
              )}
              <p className="fn-tool-note fn-tool-page-source">
                The tags follow the{' '}
                <a href={AT_TAGS_PROPOSAL} target="_blank" rel="noreferrer">
                  AT Tags proposal
                </a>
                .
              </p>
            </ToolSection>
          )}

          {fields.length > 0 && (
            <ToolSection title="What the page says" meta={fields.length === 1 ? '1 field' : `${fields.length} fields`}>
              <ToolCard flush>
                <div className="fn-tool-table-wrap">
                  <table className="fn-tool-table fn-tool-page-fields">
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fields.map((field) => (
                        <tr key={field.label}>
                          <td data-mono>{field.label}</td>
                          <td>{field.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ToolCard>
            </ToolSection>
          )}
        </>
      )}

      {!raw && (
        <ToolIntro
          items={[
            {
              term: 'The page can be fetched',
              text: 'A client that draws a link card fetches the page itself. A page that refuses the request gets no card.',
            },
            {
              term: 'It offers a link card',
              text: (
                <>
                  <code>og:title</code>, <code>og:description</code> and <code>og:image</code>, with the
                  fallbacks a client reaches for when one is missing.
                </>
              ),
            },
            {
              term: 'It names the record behind it',
              text: (
                <>
                  <code>at:canonical</code> and the other AT Tags tie a page to an at:// record. Tags
                  that are present but ignored are listed with the reason.
                </>
              ),
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
