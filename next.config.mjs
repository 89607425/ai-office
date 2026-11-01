/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  webpack: (config) => {
    config.externals = config.externals || [];
    config.externals.push('better-sqlite3');
    return config;
  },
};

export default nextConfig;
