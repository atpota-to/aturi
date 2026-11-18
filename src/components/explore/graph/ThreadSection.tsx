'use client';

import { useCallback, useEffect, useState } from 'react';
import { flattenThread, relationOf, type Relation } from '@/lib/socialGraph';
import { loadThread, loadThreadRelations, type FollowRelation, type ThreadGraph } from '@/utils/atproto/graphData';
import { Maximize2 } from 'lucide-react';
import { Segmented } from '../lexicons/primitives';
import { openExplorer } from './ThreadExplorer';
import { FlowThread } from './FlowView';
import { GRAPH_LAYOUT_OPTIONS, type GraphLayout } from './GraphTab';
import { LedgerThread } from './LedgerView';
import { OrbitThread } from './OrbitView';
import { GraphDetail, Legend, fmt, type GraphFocus } from './shared';

const THREAD_KEYS: readonly Relation[] = ['mutual', 'following', 'follower', 'further'];

/**
 * A Bluesky post's whole thread, in the same three views as an account's
 * Graph tab: Flow (the default here, since a thread reads as a conversation),
 * Orbit and Ledger. Colours are each author's relation to whoever started
 * the thread. A post nobody replied to gets one line saying so, since the
 * section always has a tab of its own in the workbench's record pane.
 */
export default function ThreadSection({ uri }: { uri: string }) {
  const [thread, setThread] = useState<ThreadGraph | null>(null);
  const [failed, setFailed] = useState(false);
  const [relations, setRelations] = useState<Map<string, FollowRelation> | null>(null);
  const [layout, setLayout] = useState<GraphLayout>('flow');
  const [focus, setFocus] = useState<GraphFocus | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    loadThread(uri, ac.signal).then(async (t) => {
      if (ac.signal.aborted) return;
      if (!t) {
        setFailed(true);
        return;
      }
      setThread(t);
      if (t.root.size < 2) return;
      const r = await loadThreadRelations(t.root.did, flattenThread(t.root).map((p) => p.did), ac.signal);
      if (r && !ac.signal.aborted) setRelations(r);
    });
    return () => ac.abort();
  }, [uri]);

  const op = thread?.root;
  const opName = op?.handle ? `@${op.handle}` : 'the first poster';

  const relationOfAuthor = useCallback(
    (did: string): Relation | 'op' => {
      if (did === op?.did) return 'op';
      const r = relations?.get(did);
      return r ? relationOf({ ...r, inCommon: null }) : 'further';
    },
    [op?.did, relations],
  );

  const relationFor = useCallback(
    (did: string): string | null => {
      if (did === op?.did) return 'Started this thread';
      const r = relations?.get(did);
      if (!r) return null;
      if (r.following && r.followedBy) return `Mutual with ${opName}`;
      if (r.following) return `${opName} follows them`;
      if (r.followedBy) return `Follows ${opName}`;
      return `Neither follows ${opName}`;
    },
    [op?.did, opName, relations],
  );

  const rkey = uri.split('/').pop() ?? '';
  const fullScreen = (
    <button type="button" className="fx-graph-tool" onClick={() => openExplorer(rkey)}>
      <Maximize2 size={14} aria-hidden />
      Full screen
    </button>
  );

  if (failed || !thread || !op || op.size < 2) {
    return (
      <section className="fn-rec-card fx-graph fx-graph-thread" aria-labelledby="fx-graph-thread-title">
        <div className="fx-graph-head">
          <h2 id="fx-graph-thread-title" className="fn-rec-h2">
            Thread
          </h2>
          {thread && fullScreen}
        </div>
        <p className="explore-placeholder" role="status">
          {failed
            ? 'Couldn’t read this thread from the Bluesky AppView.'
            : !thread
              ? 'Reading the thread…'
              : 'Nobody has replied yet. Its likes, quotes and links open full screen.'}
        </p>
      </section>
    );
  }

  const current = thread.focus;
  const props = { root: op, current, relationOfAuthor, focus, onFocus: setFocus };

  return (
    <section className="fn-rec-card fx-graph fx-graph-thread" aria-labelledby="fx-graph-thread-title">
      <div className="fx-graph-head">
        <h2 id="fx-graph-thread-title" className="fn-rec-h2">
          Thread
        </h2>
        <p className="fx-graph-status">
          {fmt(thread.posts)} posts{op.uri !== current ? ', from the first' : ''}
        </p>
        <Segmented ariaLabel="Thread layout" options={GRAPH_LAYOUT_OPTIONS} value={layout} onChange={setLayout} />
        {fullScreen}
      </div>
      <Legend keys={THREAD_KEYS} subject={opName} op />
      <div className="fx-graph-body">
        <div className="fx-graph-main">
          {layout === 'flow' && <FlowThread {...props} />}
          {layout === 'orbit' && <OrbitThread {...props} />}
          {layout === 'ledger' && <LedgerThread {...props} />}
        </div>
        <GraphDetail
          focus={focus}
          subject={{ did: op.did, handle: op.handle, displayName: op.displayName, avatar: op.avatar }}
          subjectName={opName}
          relationFor={relationFor}
          emptyText="Point at, tap or tab to a post to read it here."
        />
      </div>
    </section>
  );
}
