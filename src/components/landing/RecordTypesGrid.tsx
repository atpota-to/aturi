import {
  BookOpen,
  Camera,
  FileText,
  GitBranch,
  Highlighter,
  List,
  MessageSquare,
  Rss,
  User,
} from 'lucide-react';

type RecordType = {
  icon: React.ReactNode;
  label: string;
  collection: string;
  example: string;
};

const TYPES: RecordType[] = [
  {
    icon: <MessageSquare size={16} />,
    label: 'Posts',
    collection: 'app.bsky.feed.post',
    example: 'aturi.to/profile/handle/post/<rkey>',
  },
  {
    icon: <User size={16} />,
    label: 'Profiles',
    collection: 'app.bsky.actor.profile',
    example: 'aturi.to/profile/handle',
  },
  {
    icon: <List size={16} />,
    label: 'Lists',
    collection: 'app.bsky.graph.list',
    example: 'aturi.to/profile/handle/app.bsky.graph.list/<rkey>',
  },
  {
    icon: <Rss size={16} />,
    label: 'Feeds',
    collection: 'app.bsky.feed.generator',
    example: 'aturi.to/profile/handle/app.bsky.feed.generator/<rkey>',
  },
  {
    icon: <FileText size={16} />,
    label: 'Documents',
    collection: 'pub.leaflet.document',
    example: 'aturi.to/profile/handle/pub.leaflet.document/<rkey>',
  },
  {
    icon: <GitBranch size={16} />,
    label: 'Repositories',
    collection: 'sh.tangled.repo',
    example: 'aturi.to/profile/handle/sh.tangled.repo/<rkey>',
  },
  {
    icon: <Camera size={16} />,
    label: 'Photo galleries',
    collection: 'social.grain.gallery',
    example: 'aturi.to/profile/handle/social.grain.gallery/<rkey>',
  },
  {
    icon: <Highlighter size={16} />,
    label: 'Annotations',
    collection: 'at.margin.annotation',
    example: 'aturi.to/profile/handle/at.margin.annotation/<rkey>',
  },
  {
    icon: <BookOpen size={16} />,
    label: 'Any other lexicon',
    collection: 'collection.nsid',
    example: 'aturi.to/profile/handle/<collection>/<rkey>',
  },
];

/**
 * Grid of supported record types on the universal links landing page.
 * Communicates breadth without forcing the visitor to skim a long
 * categorized list — each tile names a record type, its lexicon NSID,
 * and what a universal link to one looks like.
 *
 * These tiles are illustrative reference, not navigation — the example
 * URLs use placeholder `handle`/`<rkey>` segments that don't resolve to
 * anything, so the cards are plain (non-interactive) elements.
 */
export default function RecordTypesGrid() {
  return (
    <div className="fl-types">
      {TYPES.map((t) => (
        <div key={t.collection} className="fl-card fl-type">
          <div className="fl-type-head">
            <span className="fl-icon-tile" data-size="s" aria-hidden>
              {t.icon}
            </span>
            <span className="fl-type-label">{t.label}</span>
          </div>
          <span className="fl-type-nsid fl-ellipsis">{t.collection}</span>
          <span className="fl-type-example fl-ellipsis">{t.example}</span>
        </div>
      ))}
    </div>
  );
}
