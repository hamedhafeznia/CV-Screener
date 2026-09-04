import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Native bindings and node:sqlite must not be bundled by webpack/turbopack.
  serverExternalPackages: ['@lancedb/lancedb', 'unpdf'],
};

export default nextConfig;
