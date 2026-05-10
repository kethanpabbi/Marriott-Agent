import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ['172.20.10.3'],
  // Suppress workspace root warning
  transpilePackages: ['lucide-react', 'framer-motion'],
};

export default nextConfig;
