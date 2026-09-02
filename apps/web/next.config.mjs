/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@vent/domain', '@vent/validation', '@vent/db'],
};

export default nextConfig;
