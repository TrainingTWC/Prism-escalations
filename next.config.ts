import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // GitHub Pages serves the app from /Prism-escalations/
  basePath: "/Prism-escalations",
  assetPrefix: "/Prism-escalations/",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
