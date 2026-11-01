/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  webpack: (config) => {
    config.externals = config.externals || [];
    config.externals.push('better-sqlite3');
    return config;
  },
};

export default nextConfig;
