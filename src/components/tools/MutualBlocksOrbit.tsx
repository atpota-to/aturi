'use client';

import { memo, useId, useMemo, useState } from 'react';
import { Filter, X } from 'lucide-react';
import { orbitLayout, type Candidate, type Person } from '@/lib/tools/mutuals';
import { Face, who } from './MutualBlocksCharts';

/**
 * The map: the scanned account in the middle, the mutuals who block any of
 * the top accounts on a ring around it, and those accounts on an outer ring,
 * each sized by how many mutuals block it. A line runs from each mutual to
 * every account it blocks. Groups of mutuals who block the same people pull
 * together (orbitLayout, mutuals.ts), so the picture shows whether the
 * agreement is broad or comes from one corner of someone's network.
 *
 * Pointing at an account lights the mutuals who block it; pointing at a
 * mutual lights the accounts it blocks. Choosing either keeps it lit, and
 * the panel underneath says who it is.
 */

const SIZE = 640;
const C = SIZE / 2;
const INNER = 128;
const OUTER = 252;
const CENTRE = 30;
/** Past this many mutuals on the ring they are drawn as dots, not faces. */
const MUTUAL_FACES_UP_TO = 48;

type Point = { x: number; y: number };

function at(angle: number, radius: number): Point {
  return { x: C + Math.sin(angle) * radius, y: C - Math.cos(angle) * radius };
}

/** A line from a mutual to an account, bowed towards the middle. */
function edge(a: Point, b: Point): string {
  const cx = C + ((a.x + b.x) / 2 - C) * 0.35;
  const cy = C + ((a.y + b.y) / 2 - C) * 0.35;
  return `M${a.x.toFixed(1)},${a.y.toFixed(1)}Q${cx.toFixed(1)},${cy.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
}

type Active = { kind: 'target'; did: string } | { kind: 'mutual'; index: number };

const nf = new Intl.NumberFormat('en-US');

/**
 * The lines, drawn once per layout. Hovering only changes which ones the
 * overlay repeats, so a map of thousands of lines does not redraw them all.
 */
const Edges = memo(function Edges({ paths }: { paths: string[] }) {
  return (
    <g className="fn-tool-mutuals-edges">
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </g>
  );
});

export default function MutualBlocksOrbit({
  account,
  targets,
  mutuals,
  profiles,
  unticked,
  mutualsRead,
  focus,
  onFocus,
}: {
  account: Person;
  /** The accounts to draw, most blocked first. */
  targets: readonly Candidate[];
  mutuals: readonly Person[];
  /** Profiles of the targets, null for one the AppView does not know. */
  profiles: ReadonlyMap<string, Person | null>;
  /** Targets left out of the list, drawn faint. */
  unticked: ReadonlySet<string>;
  mutualsRead: number;
  /** The mutual the results are narrowed to, if any. */
  focus: number | null;
  onFocus: (index: number | null) => void;
}) {
  const clipId = useId();
  const [hover, setHover] = useState<Active | null>(null);
  const [pinned, setPinned] = useState<Active | null>(null);
  const active = useMemo<Active | null>(
    () => hover ?? pinned ?? (focus !== null ? { kind: 'mutual', index: focus } : null),
    [hover, pinned, focus],
  );

  const layout = useMemo(() => orbitLayout(targets), [targets]);
  const most = targets[0]?.blockers.length ?? 1;
  const radius = (n: number) => 9 + 13 * Math.sqrt(n / Math.max(1, most));
  const mutualFaces = layout.mutuals.length <= MUTUAL_FACES_UP_TO;

  const geometry = useMemo(() => {
    const mutualAt = new Map(layout.mutuals.map((m) => [m.index, at(m.angle, INNER)]));
    const targetAt = new Map(layout.targets.map((t) => [t.did, at(t.angle, OUTER)]));
    const lines: { target: string; mutual: number; d: string }[] = [];
    for (const target of targets) {
      const to = targetAt.get(target.did);
      if (!to) continue;
      for (const m of target.blockers) {
        const from = mutualAt.get(m);
        if (from) lines.push({ target: target.did, mutual: m, d: edge(from, to) });
      }
    }
    return { mutualAt, targetAt, lines };
  }, [layout, targets]);

  const lit = useMemo(() => {
    if (!active) return null;
    const lines = geometry.lines.filter((line) =>
      active.kind === 'target' ? line.target === active.did : line.mutual === active.index,
    );
    return {
      lines,
      targets: new Set(lines.map((l) => l.target)),
      mutuals: new Set(lines.map((l) => l.mutual)),
    };
  }, [active, geometry]);

  const toggle = (next: Active) =>
    setPinned((prev) =>
      prev && prev.kind === next.kind && (prev.kind === 'target' ? prev.did === (next as typeof prev).did : prev.index === (next as typeof prev).index)
        ? null
        : next,
    );

  const activeTarget = active?.kind === 'target' ? targets.find((t) => t.did === active.did) : undefined;
  const activeMutual = active?.kind === 'mutual' ? mutuals[active.index] : undefined;

  return (
    <div className="fn-tool-mutuals-orbit">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="fn-tool-mutuals-svg"
        data-active={active ? true : undefined}
        role="group"
        aria-label={`Map of the ${targets.length} most blocked accounts and the ${layout.mutuals.length} mutuals who block them`}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>
        <circle className="fn-tool-mutuals-ring" cx={C} cy={C} r={INNER} />
        <circle className="fn-tool-mutuals-ring" cx={C} cy={C} r={OUTER} />

        <Edges paths={geometry.lines.map((l) => l.d)} />
        {lit && (
          <g className="fn-tool-mutuals-edges" data-lit>
            {lit.lines.map((line) => (
              <path key={`${line.mutual}:${line.target}`} d={line.d} />
            ))}
          </g>
        )}

        <g>
          {layout.mutuals.map((m) => {
            const p = geometry.mutualAt.get(m.index);
            const person = mutuals[m.index];
            if (!p || !person) return null;
            const on = lit?.mutuals.has(m.index);
            const r = mutualFaces ? 9 : 4;
            return (
              <g
                key={m.index}
                className="fn-tool-mutuals-node"
                data-kind="mutual"
                data-on={on || undefined}
                data-dim={lit && !on ? true : undefined}
                onPointerEnter={() => setHover({ kind: 'mutual', index: m.index })}
                onClick={() => toggle({ kind: 'mutual', index: m.index })}
              >
                <title>{`${who(person)} blocks ${m.degree} of these accounts`}</title>
                <circle cx={p.x} cy={p.y} r={r + 6} className="fn-tool-mutuals-hit" />
                {mutualFaces && person.avatar ? (
                  <>
                    <circle cx={p.x} cy={p.y} r={r + 2} className="fn-tool-mutuals-halo" />
                    <image
                      href={person.avatar}
                      x={p.x - r}
                      y={p.y - r}
                      width={r * 2}
                      height={r * 2}
                      clipPath={`url(#${clipId})`}
                      preserveAspectRatio="xMidYMid slice"
                    />
                  </>
                ) : (
                  <circle cx={p.x} cy={p.y} r={r} className="fn-tool-mutuals-dot" />
                )}
              </g>
            );
          })}
        </g>

        <g>
          {layout.targets.map((t, rank) => {
            const p = geometry.targetAt.get(t.did);
            const target = targets.find((c) => c.did === t.did);
            if (!p || !target) return null;
            const profile = profiles.get(t.did);
            const r = radius(target.blockers.length);
            const on = lit?.targets.has(t.did);
            const name = profile ? who(profile) : t.did;
            const label = `${name}, blocked by ${target.blockers.length} of ${mutualsRead} mutuals`;
            return (
              <g
                key={t.did}
                className="fn-tool-mutuals-node"
                data-kind="target"
                data-on={on || undefined}
                data-dim={lit && !on ? true : undefined}
                data-unticked={unticked.has(t.did) || undefined}
                role="button"
                tabIndex={0}
                aria-label={label}
                aria-pressed={pinned?.kind === 'target' && pinned.did === t.did}
                onPointerEnter={() => setHover({ kind: 'target', did: t.did })}
                onFocus={() => setHover({ kind: 'target', did: t.did })}
                onBlur={() => setHover(null)}
                onClick={() => toggle({ kind: 'target', did: t.did })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle({ kind: 'target', did: t.did });
                  }
                }}
              >
                <title>{label}</title>
                <circle cx={p.x} cy={p.y} r={r + 3} className="fn-tool-mutuals-halo" />
                {profile?.avatar ? (
                  <image
                    href={profile.avatar}
                    x={p.x - r}
                    y={p.y - r}
                    width={r * 2}
                    height={r * 2}
                    clipPath={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                ) : (
                  <circle cx={p.x} cy={p.y} r={r} className="fn-tool-mutuals-blankdot" />
                )}
                {rank < 3 && (
                  <text
                    x={p.x + (p.x >= C ? r + 6 : -(r + 6))}
                    y={p.y + 4}
                    textAnchor={p.x >= C ? 'start' : 'end'}
                    className="fn-tool-mutuals-count"
                  >
                    {target.blockers.length}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <g className="fn-tool-mutuals-centre">
          <circle cx={C} cy={C} r={CENTRE + 3} className="fn-tool-mutuals-halo" />
          {account.avatar ? (
            <image
              href={account.avatar}
              x={C - CENTRE}
              y={C - CENTRE}
              width={CENTRE * 2}
              height={CENTRE * 2}
              clipPath={`url(#${clipId})`}
              preserveAspectRatio="xMidYMid slice"
            />
          ) : (
            <circle cx={C} cy={C} r={CENTRE} className="fn-tool-mutuals-blankdot" />
          )}
        </g>
      </svg>

      <div className="fn-tool-mutuals-legend" aria-hidden>
        <span>
          <i data-kind="mutual" /> Mutual
        </span>
        <span>
          <i data-kind="target" /> Blocked account, larger when more mutuals block it
        </span>
      </div>

      <div className="fn-tool-mutuals-inspect">
        <div className="fn-tool-mutuals-inspect-head" aria-live="polite">
          {activeTarget ? (
            <TargetCard
              target={activeTarget}
              profile={profiles.get(activeTarget.did) ?? null}
              mutuals={mutuals}
              mutualsRead={mutualsRead}
            />
          ) : activeMutual && active?.kind === 'mutual' ? (
            <div className="fn-tool-mutuals-card">
              <Face person={activeMutual} size={40} />
              <div className="fn-tool-mutuals-card-main">
                <strong>{activeMutual.displayName || who(activeMutual)}</strong>
                <span>
                  {activeMutual.displayName ? `${who(activeMutual)} · ` : ''}
                  blocks {nf.format(lit?.targets.size ?? 0)} of the {nf.format(targets.length)} accounts on the map
                </span>
              </div>
              {focus === active.index ? (
                <button type="button" className="fx-btn fx-btn-sm" onClick={() => onFocus(null)}>
                  <X size={13} aria-hidden /> Show everyone’s
                </button>
              ) : (
                <button type="button" className="fx-btn fx-btn-sm" onClick={() => onFocus(active.index)}>
                  <Filter size={13} aria-hidden /> Only theirs
                </button>
              )}
            </div>
          ) : (
            <p className="fn-tool-note">
              Point at an account on the outer ring to see which mutuals block it, or at a mutual on the inner ring to
              see whom they block. Choose one to keep it lit.
            </p>
          )}
        </div>
        <ol className="fn-tool-mutuals-top" aria-label="Most blocked">
          {targets.slice(0, TOP_LISTED).map((target) => {
            const profile = profiles.get(target.did) ?? null;
            const on = active?.kind === 'target' && active.did === target.did;
            return (
              <li key={target.did}>
                <button
                  type="button"
                  aria-pressed={pinned?.kind === 'target' && pinned.did === target.did}
                  data-on={on || undefined}
                  onPointerEnter={() => setHover({ kind: 'target', did: target.did })}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover({ kind: 'target', did: target.did })}
                  onBlur={() => setHover(null)}
                  onClick={() => toggle({ kind: 'target', did: target.did })}
                >
                  <Face person={profile} size={22} />
                  <span>{profile ? profile.displayName || who(profile) : target.did}</span>
                  <b>{nf.format(target.blockers.length)}</b>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Accounts listed beside the map while nothing on it is chosen. */
const TOP_LISTED = 8;

/** Blockers listed by face before the rest are counted. */
const FACES_SHOWN = 14;

function TargetCard({
  target,
  profile,
  mutuals,
  mutualsRead,
}: {
  target: Candidate;
  profile: Person | null;
  mutuals: readonly Person[];
  mutualsRead: number;
}) {
  const blockers = target.blockers.map((m) => mutuals[m]).filter(Boolean);
  const name = profile ? profile.displayName || who(profile) : 'Account not found';
  return (
    <div className="fn-tool-mutuals-card">
      <Face person={profile} size={40} />
      <div className="fn-tool-mutuals-card-main">
        <strong>{name}</strong>
        <span>
          {profile?.displayName ? `${who(profile)} · ` : ''}
          blocked by {nf.format(target.blockers.length)} of {nf.format(mutualsRead)} mutuals
        </span>
        <span className="fn-tool-mutuals-stack" aria-label={blockers.map(who).join(', ')}>
          {blockers.slice(0, FACES_SHOWN).map((person) => (
            <Face key={person.did} person={person} size={20} />
          ))}
          {blockers.length > FACES_SHOWN && <em>+{nf.format(blockers.length - FACES_SHOWN)}</em>}
        </span>
      </div>
    </div>
  );
}
