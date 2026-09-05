import type { NextConfig } from "next";

// One backend, no duplicated route handlers: everything under /api is FastAPI.
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname, // a stray lockfile above this dir otherwise wins
  // The dev badge overlaps the storefront's chat input on a phone-width screen.
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
