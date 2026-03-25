import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Output as standalone for optimal Amplify Hosting deployment
  output: "standalone",

  // Silence Amplify peer dep warnings during build
  transpilePackages: ["@aws-amplify/ui-react", "aws-amplify"],

  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
