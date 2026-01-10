import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const timestamp = new Date().toISOString();
  const url = request.url;
  
  return NextResponse.json({
    status: 'ok',
    timestamp,
    url,
    message: 'OG image generation service is running',
    endpoints: {
      post: '/api/og/post?handle=<DID>&rkey=<RKEY>',
      profile: '/api/og/profile?handle=<DID_OR_HANDLE>',
      list: '/api/og/list?handle=<DID>&rkey=<RKEY>',
      static: '/api/og/static?page=<home|create|integrate|fork>',
    }
  }, {
    headers: {
      'Cache-Control': 'no-cache',
    }
  });
}





