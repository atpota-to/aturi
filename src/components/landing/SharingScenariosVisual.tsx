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
    <div className="fl-scenarios">
      <Scenario
        icon={<MessageCircle size={14} />}
        label="In a DM"
        author="ren"
        body={
          <>
            check this out:{' '}
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
    <div className="fl-card fl-scenario">
      <span className="fl-mock-label" data-accent="">
        {icon}
        {label}
      </span>
      {author && <span className="fl-mock-sub">{author}</span>}
      <div className="fl-scenario-body">{body}</div>
    </div>
  );
}

function Link({ children }: { children: React.ReactNode }) {
  return <span className="fl-scenario-link">{children}</span>;
}
