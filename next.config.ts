import type { NextConfig } from "next";

// Static export for GitHub Pages (custom domain: escalations.prismintelligence.in).
// No basePath needed — custom domain serves the site from the root.
const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  ...(isProduction && {
    output: "export",
  }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
