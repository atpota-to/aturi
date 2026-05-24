'use client';

import { AtSign, MessageCircle, Quote } from 'lucide-react';

/**
 * Three side-by-side "where you'd drop an aturi.to link" mocks. Each
 * one is a tiny stylized snippet of a different real-world surface
 * (a DM, a profile bio, a website footer) with an aturi.to URL inside.
 * Communicates that the link is portable in a way that single-app
 * deep links aren't.
 */
export default function SharingScenariosVisual() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(16rem, 1fr))',
        gap: '1rem',
      }}
    >
      <Scenario
        icon={<MessageCircle size={14} />}
        label="In a DM"
        author="ren"
        body={
          <>
            check this out —{' '}
            <Link>aturi.to/profile/aturi.to/post/3lq…</Link>
          </>
        }
      />
      <Scenario
        icon={<AtSign size={14} />}
        label="In a profile bio"
        author="@new-account"
        body={
          <>
            writer · gardener · my work lives at{' '}
            <Link>aturi.to/profile/new-account.bsky.social</Link>
          </>
        }
      />
      <Scenario
        icon={<Quote size={14} />}
        label="In a footer"
        author=""
        body={
          <>
            Follow updates →{' '}
            <Link>aturi.to/profile/handle/app.bsky.feed.generator/news</Link>
          </>
        }
      />
    </div>
  );
}

function Scenario({
  icon,
  label,
  author,
  body,
}: {
  icon: React.ReactNode;
  label: string;
  author: string;
  body: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.625rem',
        transform: 'rotate(-0.15deg)',
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          color: 'var(--text-accent)',
          fontSize: '0.7rem',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontFamily: 'var(--font-serif)',
        }}
      >
        {icon}
        {label}
      </div>
      {author && (
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
          }}
        >
          {author}
        </div>
      )}
      <div
        style={{
          fontFamily: 'var(--font-serif)',
          fontSize: '0.9rem',
          color: 'var(--text-primary)',
          lineHeight: 1.55,
        }}
      >
        {body}
      </div>
    </div>
  );
}

function Link({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '0.78rem',
        color: 'var(--text-accent)',
        borderBottom: '1px solid var(--text-accent)',
        paddingBottom: '1px',
        wordBreak: 'break-all',
      }}
    >
      {children}
    </span>
  );
}
