'use client';

import { ArrowRight, CornerDownRight, Sparkles } from 'lucide-react';

/**
 * The hero visual for /mcp: one exchange, start to finish. A question in
 * plain language, the tools the agent picked, and the record it got back.
 *
 * The numbers are real. They are aturi.to's own top post from its own
 * account, read through the same two tools named in the visual, so the
 * demo is the product running rather than a mockup of it.
 */

const TOOL_CALLS = [
  { name: 'resolve_identity', detail: '→ did:plc:6teuh…' },
  { name: 'get_author_feed', detail: '→ 8 posts + counts' },
];

export default function McpConversationVisual() {
  return (
    <div className="fl-mock fl-convo" data-size="l">
      <div className="fl-mock-bar">
        <span className="fl-convo-agent">
          <Sparkles size={13} className="fl-accent" aria-hidden />
          agent · aturi.to/api/mcp
        </span>
      </div>

      <div className="fl-mock-body fl-convo-body">
        {/* The question */}
        <p className="fl-convo-ask">
          What has @aturi.to been posting about, and which post landed best?
        </p>

        {/* What the agent called */}
        <div className="fl-convo-calls">
          {TOOL_CALLS.map((call) => (
            <div key={call.name} className="fl-convo-call">
              <CornerDownRight size={13} className="fl-faint" aria-hidden />
              <code className="fl-chip fl-mono" data-on="">
                {call.name}
              </code>
              <span className="fl-mock-sub">{call.detail}</span>
            </div>
          ))}
        </div>

        {/* What came back */}
        <div className="fl-convo-answer">
          <p>
            Spaces, record editing, and new client support. The Spaces
            announcement did best:
          </p>
          <div className="fl-convo-stats">
            <span>
              41 <small>likes</small>
            </span>
            <span>
              6 <small>reposts</small>
            </span>
            <span>
              1 <small>reply</small>
            </span>
          </div>
          <code className="fl-convo-uri">
            at://did:plc:6teuhlkizzebk6wdp42633el/app.bsky.feed.post/3mtkpzxkh5k2e
          </code>
          {/* A flex row that may shrink, so the long URL breaks instead of
              escaping the card. */}
          <span className="fl-convo-link">
            <span>aturi.to/profile/aturi.to/app.bsky.feed.post/3mtkpzxkh5k2e</span>
            <ArrowRight size={12} aria-hidden />
          </span>
        </div>
      </div>
    </div>
  );
}
