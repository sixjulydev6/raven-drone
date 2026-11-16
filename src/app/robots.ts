import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** /robots.txt (user 2026-11-16): the whole site is open to crawlers; the sitemap lists the one page. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
