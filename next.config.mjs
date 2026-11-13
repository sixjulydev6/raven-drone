/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep production checks separate from the running development preview.
  // Vercel expects the default .next output.
  distDir: process.env.NODE_ENV === "production" && !process.env.VERCEL ? ".next-production" : ".next",
  reactStrictMode: false,
  images: { unoptimized: true },
  transpilePackages: ["three"],
  /**
   * Repeat visits (2026-11-13, user: slow load on an iPhone over 4G): `public/` files were served `max-age=0,
   * must-revalidate`, so every visit re-checked ~30 models, textures and decoders with the server, one round trip each
   * on 4G. They are now fresh for a day (then reused while revalidating for a week). Their names are not hashed:
   * replacing a file in place can show the old one for up to a day, so give a changed asset a new name.
   */
  async headers() {
    const cache = [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }];
    return [
      { source: "/assets/:path*", headers: cache },
      { source: "/draco/:path*", headers: cache },
    ];
  },
};

export default nextConfig;
