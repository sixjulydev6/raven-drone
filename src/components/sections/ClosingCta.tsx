"use client";

import dynamic from "next/dynamic";
import { useInView } from "motion/react";
import { useRef } from "react";
import { ArrowRightIcon } from "@/components/ui/icons";

/** The landing drone behind the copy (ClosingCtaDrone.tsx): its own chunk, fetched when the section is near. */
const CtaDrone = dynamic(() => import("./ClosingCtaDrone"), { ssr: false });

export function ClosingCta() {
  const ref = useRef<HTMLElement>(null);
  // Load time (2026-11-06): within three screens; it then stays, so the landing is ready when the section arrives.
  const near = useInView(ref, { margin: "300% 0px 300% 0px", once: true });
  return (
    <section
      ref={ref}
      id="contact-cta"
      aria-labelledby="contact-cta-h"
      className="cta font-tight z-over-scroll-sequence relative w-full overflow-hidden bg-black text-white"
    >
      {near && <CtaDrone className="absolute inset-0" />}
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
