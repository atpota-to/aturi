import { buildOpenApiDocument } from '@/lib/openapi';

/**
 * The public API's OpenAPI 3.1 description, at the conventional /openapi.json.
 *
 * Static: the document depends only on the deploy's own origin, so it's built
 * once at compile time and served from the edge cache. CORS is wide open
 * because the point of the file is to be fetched by other people's tools —
 * Swagger UI, an LLM function-calling bridge, a codegen CLI.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(JSON.stringify(buildOpenApiDocument(), null, 2), {
    headers: {
      // The registered media type for OpenAPI (RFC 9727 / OAS 3.1). Plain
      // `application/json` is what most tools sniff for, so the profile
      // parameter is carried alongside rather than replacing it.
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
