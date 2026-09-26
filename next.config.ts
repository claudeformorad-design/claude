import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // يتيح forbidden() لصفحات الصلاحيات (403)
    authInterrupts: true,
  },
};

export default nextConfig;
