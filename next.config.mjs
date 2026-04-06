/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@aws-amplify/ui-react", "aws-amplify", "@adobe/react-spectrum"],
  serverExternalPackages: ["playwright"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // SAMEORIGIN allows the app to iframe its own static pages (same origin)
          // while still blocking cross-origin framing
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
