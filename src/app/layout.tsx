import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
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
 * downloaded and run (several seconds on slow 4G), so they start from the HTML and fill the link behind the page JS.
 *
 * 2026-11-13 (user: "taking a long time to load" on the CEO's iPhone over 4G): these were `<link rel=preload as=fetch>`
 * hints, which Safari/WebKit never hands to three's later fetch(): it downloaded all five twice (measured in WebKit:
 * each file requested again ~1.2 s later, full size from the server, ~0.85 MB extra before the reveal). Now an inline
 * script starts the downloads itself and gives each response to the first fetch() of that path (three's FileLoader:
 * GLTF, Draco, EXR), in every browser. A failed early download falls back to a normal fetch.
 */
const FIRST_FRAME_FETCHES = [
  ASSETS.raven,
  ASSETS.ravenTerrain,
  ASSETS.env,
  `${DRACO_PATH}draco_wasm_wrapper.js`,
  `${DRACO_PATH}draco_decoder.wasm`,
];
const EARLY_FETCH_SCRIPT = `(function(){var w=window,f=w.fetch;if(!f)return;var m={};
${JSON.stringify(FIRST_FRAME_FETCHES)}.forEach(function(u){try{m[u]=f(u,{credentials:"same-origin",priority:"low"});m[u].catch(function(){})}catch(e){}});
w.fetch=function(i,o){try{var u=new URL(typeof i==="string"?i:i&&i.url,location.href);var p=u.origin===location.origin&&!u.search&&m[u.pathname];
if(p){delete m[u.pathname];return p.catch(function(){return f.call(w,i,o)})}}catch(e){}return f.apply(this,arguments)}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${interTight.variable} ${dmMono.variable}`}>
      <body className="antialiased">
        {/* First-frame downloads, from the first bytes (see EARLY_FETCH_SCRIPT). */}
        <script dangerouslySetInnerHTML={{ __html: EARLY_FETCH_SCRIPT }} />
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
