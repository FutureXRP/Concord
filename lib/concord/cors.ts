/**
 * CORS for service-mode integration: PassageLab (or any allowed origin)
 * calling a deployed Concord instance cross-origin.
 *
 * CONCORD_ALLOWED_ORIGINS: comma-separated exact origins, e.g.
 *   CONCORD_ALLOWED_ORIGINS=https://passagelab.app,https://www.passagelab.app
 * Unset -> no CORS headers (same-origin / module drop-in integration).
 */

export function corsHeaders(requestOrigin: string | null): Record<string, string> {
  const allowed = (process.env.CONCORD_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length === 0 || !requestOrigin) return {};
  if (!allowed.includes(requestOrigin)) return {};
  return {
    "Access-Control-Allow-Origin": requestOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function preflightResponse(requestOrigin: string | null): Response {
  return new Response(null, { status: 204, headers: corsHeaders(requestOrigin) });
}
