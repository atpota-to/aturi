/**
 * Confidential OAuth blob upload (parity with Anisota; not used by Aturi today).
 *
 * POST /api/oauth/upload-blob  (Authorization: Bearer <frontend token>)
 *   body: { blob: <base64 string>, encoding: <mime type> }
 *
 * Forwards a base64-encoded blob to the user's PDS via uploadBlob.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Agent } from '@atproto/api';
import { oauthClient } from '@/lib/oauth/server/oauthClient';
import { frontendSessionStore } from '@/lib/oauth/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ success: false, error: 'Missing or invalid authorization header' }, { status: 401 });
  }
  const token = authHeader.slice(7);

  const userDid = await frontendSessionStore.validate(token);
  if (!userDid) {
    return NextResponse.json({ success: false, error: 'Invalid or expired session' }, { status: 401 });
  }

  let blob: string | undefined;
  let encoding: string | undefined;
  try {
    ({ blob, encoding } = (await request.json()) as { blob?: string; encoding?: string });
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!blob) return NextResponse.json({ success: false, error: 'Missing blob data' }, { status: 400 });
  if (!encoding) return NextResponse.json({ success: false, error: 'Missing encoding/content-type' }, { status: 400 });

  try {
    const oauthSession = await oauthClient.restoreSession(userDid);
    if (!oauthSession) {
      return NextResponse.json(
        { success: false, code: 'OAUTH_SESSION_MISSING', error: 'OAuth session not found or expired. Please re-authenticate.' },
        { status: 401 },
      );
    }

    const agent = new Agent(oauthSession);
    const bytes = new Uint8Array(Buffer.from(blob, 'base64'));
    const result = await agent.uploadBlob(bytes, { encoding });

    return NextResponse.json({ success: true, data: { blob: result.data.blob } });
  } catch (err) {
    const message = (err as Error).message || 'Upload failed';
    if (/expired|invalid|unauthorized/i.test(message)) {
      return NextResponse.json({ success: false, code: 'SESSION_EXPIRED', error: 'Session expired. Please re-authenticate.' }, { status: 401 });
    }
    return NextResponse.json({ success: false, error: message }, { status: (err as { status?: number }).status || 500 });
  }
}
