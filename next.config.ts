import type { NextConfig } from "next";

// GitHub Pages static export settings only apply during CI production builds.
// In local dev the app runs normally at localhost:3000/.
const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  ...(isProduction && {
    output: "export",
    basePath: "/Prism-escalations",
    assetPrefix: "/Prism-escalations/",
  }),
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
