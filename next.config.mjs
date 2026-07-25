/**
 * Two build shapes:
 *
 *  - Default: full Next.js app (API routes + UI). Deploys to Vercel as-is.
 *    outputFileTracingIncludes makes the checked-in corpus available to the
 *    serverless functions at runtime.
 *
 *  - CONCORD_STATIC=1: fully static export for GitHub Pages. The CI
 *    workflow removes app/api first; the page renders with the browser
 *    engine (client-side pipeline over /corpus static assets). Free.
 */

const isStatic = process.env.CONCORD_STATIC === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isStatic
    ? {
        output: "export",
        basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? "",
        images: { unoptimized: true },
      }
    : {
        outputFileTracingIncludes: {
          "/api/concord/query": ["./data/**"],
          "/api/concord/resolve": ["./data/**"],
        },
      }),
};

export default nextConfig;
