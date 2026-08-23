import { NextRequest } from 'next/server';
import * as mainResolve from './mainResolveRoute.ts';
import * as mainWaypoints from './mainWaypointsRoute.ts';
import * as newResolve from '@/app/api/resolve/route';
import * as newWaypoints from '@/app/api/waypoints/route';

const HEADERS_OF_INTEREST = [
  'cache-control', 'content-type',
  'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers',
];

async function snap(res: Response) {
  const h: Record<string, string | null> = {};
  for (const k of HEADERS_OF_INTEREST) h[k] = res.headers.get(k);
  let body: unknown;
  const text = await res.text();
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: h, body };
}

function req(path: string) {
  return new NextRequest(new Request(`https://aturi.to${path}`));
}

const RESOLVE_CASES = [
  '/api/resolve',
  '/api/resolve?url=',
  '/api/resolve?atUri=',
  '/api/resolve?atUri=at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%2Fapp.bsky.feed.post%2F3lbvbvbvbvb2s',
  '/api/resolve?aturi=at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%2Fapp.bsky.feed.post%2F3lbvbvbvbvb2s',
  '/api/resolve?atUri=at%3A%2F%2Fbsky.app',
  '/api/resolve?atUri=nonsense',
  '/api/resolve?atUri=%20%20at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%20%20',
  '/api/resolve?url=notaurl',
  '/api/resolve?url=ftp%3A%2F%2Fexample.com%2Fx',
  '/api/resolve?url=https%3A%2F%2Fbsky.app%2Fprofile%2Faturi.to',
  '/api/resolve?url=https%3A%2F%2Fbsky.app%2Fprofile%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%2Fpost%2F3lbvbvbvbvb2s',
  '/api/resolve?url=https%3A%2F%2Fexample.com%2Fnothing-here&headDetect=false',
  '/api/resolve?url=http%3A%2F%2F127.0.0.1%2Fx',
  '/api/resolve?url=http%3A%2F%2Flocalhost%3A8080%2Fx',
  '/api/resolve?url=https%3A%2F%2Fbsky.app%2Fprofile%2Faturi.to&composeText=hello%20world',
  '/api/resolve?atUri=at%3A%2F%2Faturi.to%2Fapp.bsky.feed.post%2F3lbvbvbvbvb2s&composeText=hi',
  '/api/resolve?url=https%3A%2F%2Faltsky.app%2Fprofile%2Fbsky.app',
  '/api/resolve?atUri=at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%2Fpub.leaflet.document%2Fabc',
  '/api/resolve?atUri=at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%2Fapp.bsky.graph.list%2Fabc',
  '/api/resolve?url=https%3A%2F%2Fbsky.app%2Fprofile%2Faturi.to&headDetect=FALSE',
  '/api/resolve?url=https%3A%2F%2Fbsky.app%2Fprofile%2Faturi.to&atUri=at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur',
];

const WAYPOINT_CASES = [
  '/api/waypoints',
  '/api/waypoints?type=post',
  '/api/waypoints?type=profile',
  '/api/waypoints?type=list',
  '/api/waypoints?type=record',
  '/api/waypoints?type=unknown',
  '/api/waypoints?type=',
  '/api/waypoints?type=bogus',
  '/api/waypoints?capability=compose',
  '/api/waypoints?capability=',
  '/api/waypoints?capability=bogus',
  '/api/waypoints?type=post&capability=compose&text=hello',
  '/api/waypoints?text=hello%20there',
];

let diffs = 0;
for (const path of RESOLVE_CASES) {
  const a = await snap(await mainResolve.GET(req(path)));
  const b = await snap(await newResolve.GET(req(path)));
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) { diffs++; console.log('RESOLVE DIFF', path, '\n MAIN:', sa.slice(0, 1200), '\n  NEW:', sb.slice(0, 1200), '\n'); }
}
for (const path of WAYPOINT_CASES) {
  const a = await snap(await mainWaypoints.GET(req(path)));
  const b = await snap(await newWaypoints.GET(req(path)));
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) { diffs++; console.log('WAYPOINTS DIFF', path, '\n MAIN:', sa.slice(0, 1200), '\n  NEW:', sb.slice(0, 1200), '\n'); }
}
// OPTIONS
for (const [name, m, n] of [['resolve', mainResolve, newResolve], ['waypoints', mainWaypoints, newWaypoints]] as const) {
  const a = await snap(await (m as any).OPTIONS());
  const b = await snap(await (n as any).OPTIONS());
  if (JSON.stringify(a) !== JSON.stringify(b)) { diffs++; console.log('OPTIONS DIFF', name, JSON.stringify(a), JSON.stringify(b)); }
}
console.log('runtime export:', (mainResolve as any).runtime, '->', (newResolve as any).runtime, '|', (mainWaypoints as any).runtime, '->', (newWaypoints as any).runtime);
console.log(`cases: ${RESOLVE_CASES.length + WAYPOINT_CASES.length + 2}, diffs: ${diffs}`);
