import type { NextConfig } from 'next';
const staticExport = process.env.DRYSTOCK_STATIC_EXPORT === '1';
if (staticExport) {
  let endpoint: URL;
  try {endpoint = new URL(process.env.NEXT_PUBLIC_API_BASE_URL || '');}
  catch {throw new Error('Static cloud build requires a public HTTPS NEXT_PUBLIC_API_BASE_URL');}
  if (endpoint.protocol !== 'https:' || ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Static cloud API must use public HTTPS without credentials or query parameters');
  }
}
const config: NextConfig = staticExport ? {output: 'export', trailingSlash: true} : {
  ...(process.env.DRYSTOCK_TEST_DIST ? {distDir:process.env.DRYSTOCK_TEST_DIST} : {}),
  async rewrites() {
    return [{source: '/api/:path*', destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/:path*`}];
  }
};
export default config;
