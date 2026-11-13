"use client";

import dynamic from "next/dynamic";
import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { whenQuiet } from "@/lib/quiet";
import { useMediaQuery } from "@/lib/use-media-query";
import { ArrowRightIcon } from "@/components/ui/icons";

/** The landing drone behind the copy (ClosingCtaDrone.tsx): its own chunk, fetched when the section is near. */
const loadCtaDrone = () => import("./ClosingCtaDrone");
const CtaDrone = dynamic(loadCtaDrone, { ssr: false });
/** Pause (no scroll input) the drone's two loading steps wait for, so neither lands on a swipe. */
const CTA_QUIET_MS = 800;

export function ClosingCta() {
  const ref = useRef<HTMLElement>(null);
  // Load time (2026-11-06): only once the section is near; it then stays, so the landing is ready when it arrives.
  // Phones (user 2026-11-10: "getting stuck at this point for 3-4 scrolls", end of Section 03): mounting it costs two
  // main-thread stalls (chunk + GLB, then a second WebGL context, texture upload and shader compile; measured 354 +
  // 461 ms at 4x CPU) and, with the old three-screen margin, they landed on the last Hardware stop just as the next
  // swipe came (touch scroll is driven by Lenis on the main thread, so those swipes were lost). Now it starts six
  // screens ahead (while Section 03's stops are read) and each half waits for a reading pause (lib/quiet.ts, no scroll
  // input for CTA_QUIET_MS; the default 300 ms is shorter than the gap between two swipes): the chunk in one pause, the
  // canvas in the next.
  // Feedback 2026-11-13 (desktop: "the drone is not coming quickly ... it is having delay"): with steady scrolling the
  // page is never quiet for CTA_QUIET_MS, so the drone only started loading once the reader stopped at the section
  // (measured: canvas 2.1 s after the section came on screen). Desktop no longer waits for a pause (its stalls are
  // short); phones still do, but never past `close` (1.5 screens ahead), where it mounts at once.
  const near = useInView(ref, { margin: "600% 0px 600% 0px", once: true });
  const close = useInView(ref, { margin: "150% 0px 150% 0px", once: true });
  const touchPhone = useMediaQuery("(max-width: 768px) and (pointer: coarse)");
  const [mount, setMount] = useState(false);
  useEffect(() => {
    if (!near) return;
    let live = true;
    const pause = () => (touchPhone && !close ? whenQuiet(CTA_QUIET_MS) : Promise.resolve());
    (async () => {
      await pause();
      await loadCtaDrone();
      await pause();
      if (live) setMount(true);
    })();
    return () => {
      live = false;
    };
  }, [near, close, touchPhone]);
  return (
    <section
      ref={ref}
      id="contact-cta"
      aria-labelledby="contact-cta-h"
      className="cta font-tight z-over-scroll-sequence relative w-full overflow-hidden bg-black text-white"
    >
      {mount && <CtaDrone className="absolute inset-0" />}
      {/* Dims the drone so the copy reads (mockup: drone in shadow, copy bright). */}
      <div aria-hidden="true" className="cta-dim pointer-events-none absolute inset-0" />
      <div className="relative flex h-full flex-col items-center justify-center px-5 text-center">
        <h2 id="contact-cta-h" className="cta-h">
          Make your product
          <br />
          impossible to scroll past.
        </h2>
        {/* User's mockup 2026-11-06 (part of the second sentence sat under a review pin: "Brand, web and 3D, built"). */}
        <p className="cta-p">
          Sixjuly is a clarity-first design studio. Brand, web and 3D, built for products that need explaining. Our 3D shortens the path from
          first look to confident decision.
        </p>
        {/* User 2026-11-10: "Talk to us" goes to the studio's contact page (was the site's contact modal). */}
        <a href="https://sixjuly.com/contact/" className="cta-btn">
          <span>Talk to us</span>
          <span className="cta-btn-arrow" aria-hidden="true">
            <ArrowRightIcon className="size-3.5" />
          </span>
        </a>
      </div>
    </section>
  );
}
