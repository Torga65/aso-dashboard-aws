const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@aws-amplify/ui-react", "aws-amplify"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Allow iframes in local dev so StaticPageFrame works; deny in production
          ...(isDev ? [] : [{ key: "X-Frame-Options", value: "DENY" }]),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
