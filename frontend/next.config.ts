import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.NODE_ENV === 'production' ? '/api/:path*' : 'http://127.0.0.1:8000/api/:path*',
      },
    ]
  },
};

export default nextConfig;
