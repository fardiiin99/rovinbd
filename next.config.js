/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone so the Docker image Coolify builds can run the app
  // with only the traced production dependencies, no full node_modules copy.
  output: 'standalone',
};
module.exports = nextConfig;
