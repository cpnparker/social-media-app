/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Chromium is loaded at RUNTIME, not bundled. webpack tracing @sparticuz's
   * ~50MB brotli-compressed binary into the route bundle would blow the
   * serverless size limit; puppeteer-core also resolves optional native deps
   * that only exist at runtime. Both are required by the live-page audit's
   * technical render (lib/optimizer/render.ts).
   */
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
    // NOTE the key: this project is on Next 14, where the option lives under
    // experimental as serverComponentsExternalPackages. The Next 15 spelling
    // (top-level serverExternalPackages) is accepted silently and does
    // nothing here — the build would succeed and the function would ship a
    // bundled Chromium, failing only at deploy on size.
    serverComponentsExternalPackages: ["puppeteer-core", "@sparticuz/chromium"],
    /**
     * Externalising keeps webpack from BUNDLING Chromium; it does not make the
     * tracer COPY it. The binary and its libraries are brotli archives under
     * bin/ — data, not JavaScript — so nothing imports them and the trace
     * misses them. The lambda then holds the package's code and none of its
     * payload, and the launch fails with the bin directory not existing.
     *
     * Only the audit route needs it, and the archives are tens of megabytes,
     * so this is scoped to that one function rather than every serverless
     * bundle in the app.
     */
    outputFileTracingIncludes: {
      "/api/optimizer/sessions/[id]/audit": ["./node_modules/@sparticuz/chromium/**"],
      // The PDF export runs the same headless Chromium; without this line the
      // binary never reaches the lambda and the route 500s in production only.
      "/api/slides/pdf": ["./node_modules/@sparticuz/chromium/**"],
      /**
       * The same failure as Chromium above, from a different cause.
       *
       * pdf-parse picks its engine with a dynamic require built from a template
       * literal — ./pdf.js/<version>/build/pdf.js. The tracer cannot follow
       * that, so the engine never reaches the lambda and every PDF comes back
       * "could not be read", in production only, which is the worst place to
       * find it. Measured: an upload that parses on a laptop failed on the
       * deployed route with exactly that message.
       *
       * ONE version, not the four the package ships (29MB in total). It must be
       * the version lib/optimizer/pdf.ts asks for by name, PDFJS_VERSION, and
       * verify-optimizer-pdf-sources asserts the two agree — a rule naming one
       * build while the code requires another ships the wrong 6MB and fails
       * exactly as silently as shipping none.
       */
      "/api/optimizer/sessions/[id]/sources": [
        "./node_modules/pdf-parse/lib/pdf.js/v1.10.100/**",
      ],
    },
  },

  /**
   * British spellings, redirected to the American route the files live under.
   *
   * One canonical page, not two copies: a duplicated route would be a second
   * file to keep in step, and the pair drifts the moment one is edited.
   *
   * These run BEFORE middleware, so auth is unaffected — the redirect resolves
   * first and the real path is then authenticated exactly as before. Query
   * strings are carried across automatically, so a deep link like
   * /engineai/optimiser?session=abc lands on the right session.
   *
   * 307, not 308. A permanent redirect is cached hard by browsers, and if the
   * British spelling is ever made canonical instead, every machine that has
   * visited would keep bouncing the other way until its cache expired. For an
   * internal tool behind auth there is no SEO argument for 308 to weigh
   * against that.
   */
  async redirects() {
    return [
      { source: "/engineai/optimiser", destination: "/engineai/optimizer", permanent: false },
      { source: "/engineai/optimiser/:path*", destination: "/engineai/optimizer/:path*", permanent: false },
    ];
  },
};

export default nextConfig;
