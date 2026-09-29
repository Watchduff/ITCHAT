import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdf-parse (via pdfjs-dist) needs its worker file resolved from node_modules
  // at runtime — bundling it breaks that resolution under Turbopack/webpack.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
