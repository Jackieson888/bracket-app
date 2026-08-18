import type { NextConfig } from "next";

const config: NextConfig = {
  experimental: {
    // proxy.ts matches /api/upload, and Next buffers the body of every
    // proxied request in memory - defaulting to 10MB, past which it forwards
    // a silently truncated body. That has to clear MAX_VIDEO_BYTES in
    // app/api/upload/route.tsx plus multipart overhead or video uploads fail.
    proxyClientMaxBodySize: "48mb",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        port: "",
        pathname: "**/image/**",
        search: "",
      },
      {
        // Poster frames for video contenders are delivered as stills from
        // Cloudinary's video resource type, e.g. /video/upload/so_0/....jpg
        protocol: "https",
        hostname: "res.cloudinary.com",
        port: "",
        pathname: "**/video/**",
        search: "",
      },
    ],
  },
};

export default config;
