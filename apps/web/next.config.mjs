/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  transpilePackages: ["@asf/core", "@asf/db"],
  // Lint and type checks run in the monorepo root scripts (`npm run lint`,
  // `npm run typecheck`). Skip the redundant in-build phase to keep CI fast.
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
