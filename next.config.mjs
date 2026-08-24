/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
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
