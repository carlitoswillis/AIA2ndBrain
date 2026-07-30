/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["better-sqlite3", "jsdom", "defuddle"],
  },
};

module.exports = nextConfig;
