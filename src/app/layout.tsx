import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
import { preload } from "react-dom";
import { ASSETS, DRACO_PATH } from "@/lib/assets";
import { LOAD_ETA_SCRIPT } from "@/lib/load-eta";
import { Navbar } from "@/components/Navbar";
import { SmoothScroll } from "@/components/SmoothScroll";
import "./globals.css";

/**
 * Sections 03/04 type (user's Figma "Drone Website"): Inter Tight (variable, 400/500 used) and DM Mono Regular, Latin
 * subsets self-hosted from Google Fonts (OFL) because next/font/google failed to fetch on the Vercel build machine.
 * Not preloaded: only the sections below the stage use them (load time, 2026-11-05).
 */
const interTight = localFont({ src: "./fonts/InterTight-latin-var.woff2", weight: "100 900", variable: "--font-inter-tight", display: "swap", preload: false });
const dmMono = localFont({ src: "./fonts/DMMono-Regular-latin.woff2", weight: "400", variable: "--font-dm-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  title: "Raven — medical delivery drone concept",
  description:
    "The road goes around. Raven goes over. A medical delivery drone concept exploring a direct air link from a regional health centre to remote hill clinics.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0f0f0f",
  width: "device-width",
  initialScale: 1,
};

/**
 * Load time (2026-11-05): the scene's first-frame files are otherwise requested only after the three.js chunks have
 * downloaded and run (several seconds on slow 4G). Hinted from the HTML at low priority, they fill the link behind the
 * page JS instead of after it. Same mode/credentials as three's FileLoader fetch, so the requests are reused.
 */
const FIRST_FRAME_FETCHES = [
  ASSETS.raven,
  ASSETS.ravenTerrain,
  ASSETS.env,
  `${DRACO_PATH}draco_wasm_wrapper.js`,
  `${DRACO_PATH}draco_decoder.wasm`,
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  for (const href of FIRST_FRAME_FETCHES) preload(href, { as: "fetch", crossOrigin: "anonymous", fetchPriority: "low" });
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${interTight.variable} ${dmMono.variable}`}>
      <body className="antialiased">
        {/* Loader ETA (lib/load-eta.ts): runs from the first bytes, long before the page JS hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: LOAD_ETA_SCRIPT }} />
        <SmoothScroll>
          <Navbar />
          {children}
        </SmoothScroll>
      </body>
    </html>
  );
}
