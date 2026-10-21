import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* توسعه با 127.0.0.1 باز می‌شود (پورت 3000 رزرو است) — تب HMR بدون مجوز مسدود می‌شود */
  allowedDevOrigins: ["127.0.0.1"],
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
