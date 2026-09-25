import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // يتيح forbidden() لصفحات الصلاحيات (403)
    authInterrupts: true,
  },
};

export default nextConfig;
