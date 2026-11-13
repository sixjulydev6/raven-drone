"use client";

import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { CALLOUT_BODY, CALLOUT_BOX, CALLOUT_H, kickerText } from "./callout-layout";
import { useMediaQuery } from "@/lib/use-media-query";
import { ALTITUDE_COPY, ROUTE_CLINIC_IMAGE, ROUTE_COPY, ROUTE_FLIGHT, routeScreen, type SiteImage } from "@/lib/payload";

/** Pin geometry from the `net` section's CSS (.pin__btn 44px, .pin__label at 54/13; clinic stem 84px, summit 96px). */
const PIN = { size: 44, labelX: 54, labelY: 13 };
const STEMS = [84, 96];

const ENTER = { opacity: 0, y: 8, color: "#FF2200" };
const SETTLE = { opacity: 1, y: 0, color: "#FFFFFF" };
const EXIT = { opacity: 0, y: -8, color: "#FF2200" };
const YELLOW = "#ffcb47";

const metres = (m: number) => `${Math.round(m).toLocaleString("en-US")} m`;

/**
 * Site card (user mockup 2026-11-06, was photo left + name right 300 x 92): portrait photo on top with an even margin
 * (`pad`) on the top and sides, the name centred in the band below (`nameH`). `w`/`h` = the whole card, px.
 */
const card = (w: number, pad: number, imgH: number, nameH: number, font: number) => ({ w, h: pad + imgH + nameH, pad, imgH, nameH, font, gutter: 12 });
const CARD = card(140, 10, 130, 40, 13); // mockup proportions (300 x 404, photo 256 x 292); user 2026-11-06: smaller (was 180 wide)
/** Phones (user 2026-11-06: "make this card small in mobile", both cards): about two thirds of the desktop card. */
const CARD_PHONE = card(112, 8, 104, 32, 10); // was 136 wide
const PHONE_QUERY = "(max-width: 767px)";
const cardFor = (phone: boolean) => (phone ? CARD_PHONE : CARD);
const isPhone = () => typeof window !== "undefined" && window.innerWidth < 768;
const smooth = (t: number) => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};
/** Card open share for the drone's place on leg 1 (0 = pin, 1 = card): opens as it settles at the clinic. */
export const clinicOpenAt = (fly: number) => smooth((fly - 0.94) / 0.06);

export type ClinicPinRefs = {
  root: React.RefObject<HTMLDivElement | null>;
  head: React.RefObject<HTMLDivElement | null>;
  plus: React.RefObject<HTMLSpanElement | null>;
  card: React.RefObject<HTMLDivElement | null>;
  label: React.RefObject<HTMLSpanElement | null>;
};
export const useClinicPinRefs = (): ClinicPinRefs => ({
  root: useRef<HTMLDivElement>(null),
  head: useRef<HTMLDivElement>(null),
  plus: useRef<HTMLSpanElement>(null),
  card: useRef<HTMLDivElement>(null),
  label: useRef<HTMLSpanElement>(null),
});

/**
 * Ridge Clinic pin: the `net` section pin whose round head opens into a card (photo + name) once the drone has
 * arrived (user 2026-11-05: "the plus has to change to image ... like showing a pin"). Same stem and foot as `Pin`;
 * positioned and opened every frame by `placeClinicPin`.
 */
/** Failed photo loads retried before the neutral tile stays. */
const IMG_RETRIES = 3;

export function ClinicPin({
  stem,
  refs,
  name = ROUTE_COPY.destination,
  image = ROUTE_CLINIC_IMAGE,
}: {
  stem: number;
  refs: ClinicPinRefs;
  name?: string;
  image?: SiteImage;
}) {
  // Photos sometimes missing (feedback 2026-11-13): they were 250 KB PNGs queued behind the HD swap's large downloads,
  // and one failed request hid the photo for the rest of the visit. Now ~40 KB WebP, preloaded at high priority, and a
  // failed load retries (cache-busted) before falling back to the neutral tile.
  preload(image.src, { as: "image", fetchPriority: "high" });
  const [attempt, setAttempt] = useState(0);
  const broken = attempt > IMG_RETRIES;
  const card = cardFor(useMediaQuery(PHONE_QUERY));
  return (
    <div ref={refs.root} className="absolute top-0 left-0 flex flex-col items-center" style={{ width: PIN.size, opacity: 0 }}>
      {/* Above the stem: a card slid down its stem (short screens) must cover it, not show it through the name. */}
      <div className="relative z-[1]" style={{ width: PIN.size, height: PIN.size }}>
        <div
          ref={refs.head}
          className="absolute bottom-0 left-1/2 overflow-hidden"
          style={{
            width: PIN.size,
            height: PIN.size,
            transform: "translateX(-50%)",
            borderRadius: PIN.size / 2,
            border: "1px solid rgba(230, 230, 230, 0.35)",
            background: "#1e1e1e",
            willChange: "width, height, transform",
          }}
        >
          <span ref={refs.plus} aria-hidden="true" className="absolute inset-0 grid place-items-center text-white">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
              <path d="M7 1.5v11M1.5 7h11" />
            </svg>
          </span>
          <div
            ref={refs.card}
            className="absolute top-0 left-0 flex flex-col"
            style={{ width: card.w, height: card.h, padding: `${card.pad}px ${card.pad}px 0`, opacity: 0 }}
          >
            <span className="relative block w-full shrink-0 overflow-hidden bg-[#2c2c2c]" style={{ height: card.imgH }}>
              {/* Neutral tile if the photo fails to load. */}
              <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-white/35">
                <svg width="22" height="22" viewBox="0 0 30 30" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
                  <path d="M4 26V12l11-7 11 7v14H4z" />
                  <path d="M15 12v8M11 16h8" />
                </svg>
              </span>
              {!broken && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={attempt}
                  src={attempt ? `${image.src}?retry=${attempt}` : image.src}
                  alt={image.alt}
                  className="absolute inset-0 size-full object-cover"
                  loading="eager"
                  fetchPriority="high"
                  onError={() => window.setTimeout(() => setAttempt((a) => a + 1), 600 * (attempt + 1))}
                  draggable={false}
                />
              )}
            </span>
            <span
              style={{ fontSize: card.font, height: card.nameH }}
              className="grid place-items-center font-mono leading-none tracking-[0.08em] whitespace-nowrap text-white uppercase"
            >
              {name}
            </span>
          </div>
        </div>
        <span
          ref={refs.label}
          className="absolute font-mono text-[11px] tracking-[0.08em] whitespace-nowrap uppercase"
          style={{ left: PIN.labelX, top: PIN.labelY, color: "rgba(230, 230, 230, 0.55)" }}
        >
          {name}
        </span>
      </div>
      <span
        aria-hidden="true"
        className="block w-px"
        style={{ height: stem, background: "linear-gradient(rgba(230, 230, 230, 0.55), rgba(230, 230, 230, 0.15))" }}
      />
    </div>
  );
}

/** Positions the clinic pin (stem foot on the site) and opens its head into the card by `open` (0..1). */
export function placeClinicPin(refs: ClinicPinRefs, x: number, y: number, stem: number, opacity: number, open: number) {
  const root = refs.root.current;
  if (root) {
    root.style.transform = `translate3d(${(x - PIN.size / 2).toFixed(1)}px, ${(y - PIN.size - stem).toFixed(1)}px, 0)`;
    root.style.opacity = opacity.toFixed(3);
  }
  const head = refs.head.current;
  if (head) {
    const CARD = cardFor(isPhone());
    const w = PIN.size + (CARD.w - PIN.size) * open;
    const h = PIN.size + (CARD.h - PIN.size) * open;
    // Keep the open card on screen: slide it sideways on its stem near the edges. Only as it opens (x open): the closed
    // round pin stays on its stem (on phones the camera pans to Summit Station and Ridge Clinic ends at the left edge).
    const W = window.innerWidth;
    const left = x - w / 2;
    const dx = (left < CARD.gutter ? CARD.gutter - left : x + w / 2 > W - CARD.gutter ? W - CARD.gutter - (x + w / 2) : 0) * open;
    // Short screens (landscape phones, mobile pass 2026-11-06): the site sits high, so the open card rose under the nav
    // bar. Slide it down its stem until it clears the bar (same clamp as --nav-height). Only as it opens (x open): the
    // closed + pin slid down its own stem too and sat over it (user 2026-11-09).
    const navH = Math.min(Math.max(56, W * 0.054), 82);
    const dy = Math.max(0, navH + CARD.gutter - (y - stem - h)) * open;
    head.style.width = `${w.toFixed(1)}px`;
    head.style.height = `${h.toFixed(1)}px`;
    head.style.transform = `translate(calc(-50% + ${dx.toFixed(1)}px), ${Math.min(dy, stem).toFixed(1)}px)`;
    head.style.borderRadius = `${(PIN.size / 2) * (1 - open) + 2 * open}px`;
    head.style.background =
      open > 0
        ? `rgba(${Math.round(30 + 42 * open)}, ${Math.round(30 + 42 * open)}, ${Math.round(30 + 42 * open)}, 1)` // opaque: the stem showed through the open card (user 2026-11-06)
        : "#1e1e1e";
  }
  if (refs.plus.current) refs.plus.current.style.opacity = smooth(1 - open * 2.5).toFixed(3);
  if (refs.card.current) refs.card.current.style.opacity = smooth((open - 0.55) / 0.45).toFixed(3);
  const label = refs.label.current;
  if (label) {
    label.style.opacity = smooth(1 - open * 3).toFixed(3);
    const lw = label.offsetWidth;
    label.style.left = x - PIN.size / 2 + PIN.labelX + lw <= window.innerWidth - 12 ? `${PIN.labelX}px` : `${PIN.size - PIN.labelX - lw}px`;
  }
}

/** One `net` section pin, its stem's foot on a site (positioned every frame by the parent's loop). */
export function Pin({
  name,
  stem,
  pinRef,
  labelRef,
}: {
  name: string;
  stem: number;
  pinRef: React.RefObject<HTMLDivElement | null>;
  labelRef: React.RefObject<HTMLSpanElement | null>;
}) {
  return (
    <div ref={pinRef} className="absolute top-0 left-0 flex flex-col items-center" style={{ width: PIN.size, opacity: 0 }}>
      <span
        aria-hidden="true"
        className="grid place-items-center rounded-full text-white"
        style={{ width: PIN.size, height: PIN.size, border: "1px solid rgba(230, 230, 230, 0.35)", background: "#1e1e1e" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M7 1.5v11M1.5 7h11" />
        </svg>
      </span>
      <span
        ref={labelRef}
        className="absolute font-mono text-[11px] tracking-[0.08em] whitespace-nowrap uppercase"
        style={{ left: PIN.labelX, top: PIN.labelY, color: "rgba(230, 230, 230, 0.55)" }}
      >
        {name}
      </span>
      <span
        aria-hidden="true"
        className="block w-px"
        style={{ height: stem, background: "linear-gradient(rgba(230, 230, 230, 0.55), rgba(230, 230, 230, 0.15))" }}
      />
    </div>
  );
}

/**
 * Mountain stage callout (lib/payload.ts ROUTE_*; user 2026-11-03): the altitude in the right-hand callout block
 * (callout-layout.ts, user mockup 2026-11-05; was top left), counting up from a random 80-90 m with the drone's climb along the route (routeScreen.alt; user: "we should not
 * show 5000m in the starting itself"), and the `net` section's two pins (Ridge Clinic, Summit Station) on their sites,
 * each coming in as its leg of the connected route arrives (routeScreen.draw / draw2). Display only: the section's pins opened an info card, which
 * was removed. Screen readers get the final figure.
 */
export function RouteCallout() {
  const layer = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const clinic = useClinicPinRefs();
  const summit = useRef<HTMLDivElement>(null);
  const summitLabel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let raf = 0;
    let shownText = "";
    // User 2026-11-05: "should not start from 0, start from 80 or 90 and random show number increasing". A random
    // start in 80-90 m that creeps up in small random steps (a live altimeter), then climbs with the drone and still
    // lands on exactly topM at the top.
    const START = 80 + Math.floor(Math.random() * 11);
    const DRIFT_MAX = 40;
    let drift = 0;
    let nextDrift = performance.now() + 250;
    const tick = () => {
      const r = routeScreen;
      if (layer.current) layer.current.style.visibility = r.ok ? "visible" : "hidden";
      const now = performance.now();
      if (now >= nextDrift && drift < DRIFT_MAX) {
        drift = Math.min(drift + 1 + Math.floor(Math.random() * 3), DRIFT_MAX);
        nextDrift = now + 180 + Math.random() * 320;
      }
      const base = START + drift;
      const text = metres(base + r.alt * (ROUTE_FLIGHT.topM - base));
      if (counter.current && text !== shownText) counter.current.textContent = shownText = text;
      // Each pin comes in as its leg of the connected route arrives (clinic: leg 1, summit station: leg 2).
      const shownAt = (d: number) => Math.min(Math.max((d - 0.8) / 0.2, 0), 1);
      // The clinic pin opens into its card when the drone arrives there.
      placeClinicPin(clinic, r.vx, r.vy, STEMS[0], r.ok ? shownAt(r.draw) : 0, clinicOpenAt(r.fly));
      const pin = summit.current;
      if (pin) {
        // Section: translate(x, y) translate(-50%, -100%), the stem's foot on the site.
        pin.style.transform = `translate3d(${(r.v2x - PIN.size / 2).toFixed(1)}px, ${(r.v2y - PIN.size - STEMS[1]).toFixed(1)}px, 0)`;
        pin.style.opacity = (r.ok2 ? shownAt(r.draw2) : 0).toFixed(3);
      }
      // Label right of the ring (section), or left of it where the screen ends (phones).
      const label = summitLabel.current;
      if (label) {
        const w = label.offsetWidth;
        const right = r.v2x - PIN.size / 2 + PIN.labelX + w <= window.innerWidth - 12;
        label.style.left = right ? `${PIN.labelX}px` : `${PIN.size - PIN.labelX - w}px`;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className={CALLOUT_BOX}>
        <motion.p
          className="text-m-mono md:text-d-mono mb-2 font-mono uppercase"
          style={{ color: YELLOW }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: "easeInOut", delay: 0.3 }}
        >
          {kickerText(ALTITUDE_COPY.kicker)}
        </motion.p>
        <motion.h2
          className={CALLOUT_H}
          initial={ENTER}
          animate={SETTLE}
          exit={EXIT}
          transition={{ duration: 0.4, ease: "easeInOut", delay: 0.4 }}
          aria-label={ALTITUDE_COPY.value}
        >
          <span ref={counter} aria-hidden="true">
            {metres(85)}
          </span>
        </motion.h2>
        <motion.p
          className={CALLOUT_BODY}
          initial={ENTER}
          animate={{ ...SETTLE, color: "rgba(255,255,255,0.82)" }}
          exit={EXIT}
          transition={{ duration: 0.4, ease: "easeInOut", delay: 0.6 }}
        >
          {ALTITUDE_COPY.body}
        </motion.p>
      </div>
      <div ref={layer} className="pointer-events-none absolute inset-0" style={{ visibility: "hidden" }}>
        {/* Fades back in when re-entered mid-exit (it only had an exit, so an interrupted exit left it at 0, user
            2026-11-05: the pins and the clinic card vanished until the section was left and re-entered). */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="absolute inset-0">
          <ClinicPin stem={STEMS[0]} refs={clinic} />
          <Pin name={ROUTE_COPY.second} stem={STEMS[1]} pinRef={summit} labelRef={summitLabel} />
        </motion.div>
      </div>
    </div>
  );
}
