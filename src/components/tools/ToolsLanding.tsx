import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import CrossLinkCards from '@/components/landing/CrossLinkCards';
import { toolHref, toolsByGroup } from '@/lib/tools/catalog';

/**
 * The hub: every tool in the catalog (src/lib/tools/catalog.ts), by group. A
 * new tool is a route under /tools plus an entry there. All of them are
 * static pages, so the links keep Next's default prefetch.
 */
export default function ToolsLanding() {
  const groups = toolsByGroup();
  return (
    <div className="fn-tools">
      <AppearIn rise>
        <header className="fn-x-intro">
          <div className="fn-x-intro-copy">
            <span className="fn-kicker">Tools</span>
            <h1>Small tools for the Atmosphere</h1>
            <p>
              Single-purpose utilities for atproto: check a handle, validate a record, watch the
              network. Each one works on its own page and keeps its input in the link, so a result
              can be shared.
            </p>
          </div>
        </header>
      </AppearIn>

      {groups.map(({ group, tools }, index) => (
        <AppearIn key={group.id} delay={0.06 + index * 0.03}>
          <section className="fn-t-group" aria-labelledby={`fn-t-group-${group.id}`}>
            <header className="fn-t-group-head">
              <h2 id={`fn-t-group-${group.id}`}>{group.title}</h2>
              <p>{group.blurb}</p>
            </header>
            <nav aria-label={`${group.title} tools`} className="fn-x-tiles fn-t-tiles">
              {tools.map(({ slug, title, desc, Icon }) => (
                <Link key={slug} href={toolHref(slug)} className="fn-x-tile fn-t-tile">
                  <span aria-hidden className="fn-x-tile-icon">
                    <Icon size={18} />
                  </span>
                  <span className="fn-x-tile-text">
                    <span className="fn-x-tile-title">{title}</span>
                    <span className="fn-x-tile-desc">{desc}</span>
                  </span>
                  <ChevronRight size={16} aria-hidden className="fn-x-tile-chev" />
                </Link>
              ))}
            </nav>
          </section>
        </AppearIn>
      ))}

      <AppearIn delay={0.24} className="fn-t-cross">
        <CrossLinkCards current="tools" />
      </AppearIn>
    </div>
  );
}
