/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', 'parquetjs'],
};

module.exports = nextConfig;
