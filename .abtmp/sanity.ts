import * as newResolve from '@/app/api/resolve/route';
import * as newWaypoints from '@/app/api/waypoints/route';
function req(path: string) { return new Request(`https://aturi.to${path}`) as never; }
for (const p of [
  '/api/resolve?url=https%3A%2F%2Faltsky.app%2Fprofile%2Fbsky.app',
  '/api/resolve?url=https%3A%2F%2Fbsky.app%2Fprofile%2Faturi.to',
  '/api/resolve?atUri=at%3A%2F%2Fdid%3Aplc%3Az72i7hdynmk6r22z27h6tvur%2Fapp.bsky.feed.post%2F3lbvbvbvbvb2s',
  '/api/resolve?url=http%3A%2F%2F127.0.0.1%2Fx',
]) {
  const r = await newResolve.GET(req(p));
  const t = await r.text();
  console.log(p, '->', r.status, t.slice(0, 260).replace(/\s+/g, ' '));
}
const w = await newWaypoints.GET(req('/api/waypoints?type=post&capability=compose&text=hi'));
console.log('waypoints ->', w.status, (await w.text()).slice(0, 200).replace(/\s+/g, ' '));
