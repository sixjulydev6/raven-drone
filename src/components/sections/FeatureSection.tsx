"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useLenis } from "lenis/react";
import { useEffect, useRef, useState } from "react";
import { FEATURE_BODY, FEATURE_HEADING, FEATURE_KICKER, FEATURES, featureSrcSet, FEATURE_SIZES } from "@/lib/features";
import { prefetchImages } from "@/lib/prefetch-images";

/** Hexa mark from the card's bottom-right corner (Figma 128:820 "Union"). */
function HexaMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 35 39" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.057 0C18.8243 5.44254e-05 20.257 1.43272 20.257 3.2C20.257 4.69101 19.2371 5.94353 17.857 6.29883V14.4668C19.0173 14.6615 20.0363 15.2722 20.7554 16.1406L27.8289 12.0563C27.4467 10.6835 28.0221 9.17394 29.3132 8.42852C30.8438 7.5449 32.8011 8.06948 33.6847 9.6C34.5683 11.1305 34.0437 13.0874 32.5132 13.9711C31.2219 14.7167 29.627 14.46 28.6293 13.4422L21.5562 17.5262C21.7502 18.0474 21.857 18.6112 21.857 19.2C21.857 19.7887 21.7501 20.3523 21.5562 20.8734L28.6293 24.9574C29.627 23.9398 31.222 23.6834 32.5132 24.4289C34.0437 25.3126 34.5683 27.2695 33.6847 28.8C32.8011 30.3305 30.8438 30.8547 29.3132 29.9711C28.0221 29.2256 27.4466 27.7161 27.8289 26.3434L20.7554 22.259C20.0363 23.1275 19.0174 23.7381 17.857 23.9328V32.1008C19.2371 32.456 20.257 33.709 20.257 35.2C20.257 36.9673 18.8243 38.3999 17.057 38.4C15.2897 38.4 13.857 36.9673 13.857 35.2C13.857 33.7089 14.8768 32.456 16.257 32.1008V23.9328C15.0965 23.7381 14.0774 23.1276 13.3582 22.259L6.28434 26.3434C6.66674 27.7162 6.09163 29.2256 4.80035 29.9711C3.26982 30.8547 1.31292 30.3305 0.429258 28.8C-0.454365 27.2695 0.0699456 25.3126 1.60035 24.4289C2.8916 23.6834 4.48659 23.9399 5.48434 24.9574L12.557 20.8738C12.3631 20.3526 12.257 19.7887 12.257 19.2C12.257 18.6111 12.363 18.0471 12.557 17.5258L5.48434 13.4422C4.48661 14.4599 2.89168 14.7166 1.60035 13.9711C0.0699493 13.0874 -0.454364 11.1305 0.429258 9.6C1.31292 8.06949 3.26983 7.54527 4.80035 8.42891C6.09151 9.17436 6.66653 10.6835 6.28434 12.0563L13.3582 16.1406C14.0774 15.2721 15.0966 14.6615 16.257 14.4668V6.29922C14.8768 5.94402 13.857 4.69111 13.857 3.2C13.857 1.43269 15.2897 0 17.057 0ZM17.057 33.2C15.9524 33.2 15.057 34.0954 15.057 35.2C15.057 36.3046 15.9524 37.2 17.057 37.2C18.1615 37.1999 19.057 36.3045 19.057 35.2C19.057 34.0955 18.1615 33.2001 17.057 33.2ZM4.93238 26.2C4.38008 25.2435 3.15691 24.9157 2.20035 25.468C1.24386 26.0203 0.916095 27.2435 1.46832 28.2C2.02059 29.1566 3.24378 29.4843 4.20035 28.932C5.15694 28.3797 5.48467 27.1566 4.93238 26.2ZM31.9132 25.468C30.9567 24.9157 29.7335 25.2434 29.1812 26.2C28.629 27.1566 28.9567 28.3797 29.9132 28.932C30.8698 29.4843 32.093 29.1566 32.6453 28.2C33.1976 27.2434 32.8698 26.0203 31.9132 25.468ZM4.20035 9.46797C3.24378 8.91575 2.02059 9.24344 1.46832 10.2C0.91609 11.1565 1.24386 12.3797 2.20035 12.932C3.15692 13.4843 4.38008 13.1565 4.93238 12.2C5.48467 11.2434 5.15694 10.0203 4.20035 9.46797ZM32.6453 10.2C32.093 9.24343 30.8698 8.91569 29.9132 9.46797C28.9567 10.0203 28.6289 11.2434 29.1812 12.2C29.7335 13.1566 30.9567 13.4843 31.9132 12.932C32.8698 12.3797 33.1976 11.1566 32.6453 10.2ZM17.057 1.2C15.9524 1.2 15.057 2.09543 15.057 3.2C15.057 4.30457 15.9524 5.2 17.057 5.2C18.1615 5.19995 19.057 4.30454 19.057 3.2C19.057 2.09546 18.1615 1.20005 17.057 1.2Z"
      />
    </svg>
  );
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/** Card copy swap: the active entry settles in place, the others sit `px` above (passed) or below (next), hidden. */
function swap(d: number, px: number, delay = 0): React.CSSProperties {
  const on = d === 0;
  return {
    opacity: on ? 1 : 0,
    transform: `translateY(calc(var(--u) * ${on ? 0 : d > 0 ? px : -px}))`,
    transition: on
      ? `opacity 0.45s ${0.15 + delay}s ease-out, transform 0.6s ${0.15 + delay}s ${EASE}`
      : `opacity 0.25s ease-in, transform 0.4s ${EASE}`,
    pointerEvents: on ? undefined : "none",
  };
}

/**
 * Section 03 (user mockups 2026-11-05, "Feature 7/8"; first built from Figma 128:804/830/857): a pinned screen that
 * slides up over the 3D stage, then one feature per scroll stop (the stops are chapter snaps in story-map.ts
 * `pageBands`, one gesture each). `#features-band` is (n) screens tall: the pinned screen stays while the page moves
 * (n - 1) screens, and the active feature is the nearest stop. Full-bleed render (cross-fade with a slow settle), heading
 * top left, a compact card bottom right whose copy leaves toward the scroll direction, and a right-hand indicator
 * (BUILT / SENSOR / MOTOR) that slides so the active label sits on the centre line with its neighbours beside it.
 * Desktop sizes in `--u` = one 1920-wide frame pixel (fits the frame to the viewport width or height).
 */
export function FeatureSection() {
  const band = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const lenis = useLenis();
  /**
   * Indicator labels are clickable (user 2026-11-06): scroll to that feature's stop (the active feature is the nearest
   * whole screen into the band, see the scroll listener below), eased like the nav bar's chapter jumps.
   */
  const goTo = (i: number) => {
    const el = band.current;
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY + i * window.innerHeight;
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    if (lenis) lenis.scrollTo(y, { duration: 0.8, easing: ease });
    else window.scrollTo({ top: y, behavior: "smooth" });
  };
  // Heading fade-in (user 2026-11-05): plays as the section slides up into view, again on every re-entry.
  const stage = useRef<HTMLElement>(null);
  const headingIn = useInView(stage, { amount: 0.35 });
  const reduced = useReducedMotion();
  const reveal = (i: number) => ({
    initial: false as const,
    animate: headingIn ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 0, y: reduced ? 0 : 28, filter: reduced ? "blur(0px)" : "blur(6px)" },
    transition: headingIn ? { duration: 0.9, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] as const } : { duration: 0.2 },
  });

  // Phones (user 2026-11-06: the heading copy ran over the render on some phones): the render band starts below the
  // heading's real bottom and ends above the card's top (CSS --head-bottom / --card-top, px from the stage top), since
  // the heading wraps to more lines on narrow or short screens than the fixed 28% / 36% band allowed for.
  const heading = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const st = stage.current;
    const h = heading.current;
    const c = card.current;
    if (!st || !h || !c) return;
    const measure = () => {
      // Layout boxes (offset*), not getBoundingClientRect: the heading's reveal moves it with a transform.
      st.style.setProperty("--head-bottom", `${h.offsetTop + h.offsetHeight}px`);
      st.style.setProperty("--card-top", `${c.offsetTop}px`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(st);
    ro.observe(h);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Fetched in the background once the page has loaded (lib/prefetch-images.ts), active-first order.
  useEffect(() => prefetchImages(FEATURES.map((f) => ({ src: f.image, srcSet: featureSrcSet(f), sizes: FEATURE_SIZES }))), []);

  useEffect(() => {
    const update = () => {
      const el = band.current;
      if (!el) return;
      const vh = window.innerHeight;
      const k = Math.min(Math.max(Math.round(-el.getBoundingClientRect().top / vh), 0), FEATURES.length - 1);
      if (k !== activeRef.current) {
        activeRef.current = k;
        setActive(k);
      }
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div
      ref={band}
      id="features-band"
      className="z-over-scroll-sequence relative w-full"
      style={{ height: `${FEATURES.length * 100}dvh` }}
    >
      <section
        ref={stage}
        id="features"
        aria-label="Raven features"
        className="feature-stage font-tight sticky top-0 h-dvh w-full overflow-hidden bg-[#060606] text-white"
      >
        {/* Images, stacked and cross-faded. Each sits in a frame that recentres the render on desktop (lib/features.ts). */}
        {FEATURES.map((f, i) => (
          <div
            key={f.id}
            className="feature-frame absolute inset-0 isolate"
            style={{ "--fx": `${f.frame.x}%`, "--fy": `${f.frame.y}%`, "--fs": f.frame.s } as React.CSSProperties}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={f.image}
              srcSet={featureSrcSet(f)}
              sizes={FEATURE_SIZES}
              alt={i === active ? f.alt : ""}
              aria-hidden={i !== active}
              // Far below the stage: no SSR preload during the loader (load time, 2026-11-05).
              loading="lazy"
              decoding="async"
              className={`absolute inset-0 h-full w-full object-contain md:object-cover md:object-center${f.fadeBottom !== undefined && f.aspect ? " feature-img-fadeb" : ""}`}
              style={{
                ...(f.fadeBottom !== undefined && f.aspect && ({ "--fb": `${f.fadeBottom}%`, "--ar": f.aspect } as React.CSSProperties)),
                // User 2026-11-05: a quick swap. The outgoing render is gone in 0.2 s so it never shows behind the
                // incoming one (the renders are smaller than the screen now, so a held old image showed round the
                // new one's edges); the new one fades in over 0.4 s with a short settle.
                // Black gradient over a hard cut on the render's left edge (user 2026-11-05).
                ...(f.fadeLeft !== undefined && {
                  maskImage: `linear-gradient(90deg, transparent ${f.fadeLeft}%, #000 ${f.fadeLeft + 22}%)`,
                }),
                zIndex: i === active ? 1 : 0,
                opacity: i === active ? 1 : 0,
                transform: `scale(${i === active ? 1 : 1.02})`,
                transition:
                  i === active
                    ? "opacity 0.4s 0.05s ease-out, transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)"
                    : "opacity 0.2s ease-in, transform 0s 0.2s",
              }}
            />
          </div>
        ))}
        {/* Left shade so the heading reads over bright parts of the render. */}
        <div aria-hidden="true" className="feature-shade pointer-events-none absolute inset-0" />

        <div className="feature-layout absolute inset-0">
          <div ref={heading} className="feature-heading">
            <motion.p className="section-kicker font-dm uppercase" {...reveal(0)}>
              / {FEATURE_KICKER}
            </motion.p>
            <h2 className="feature-h">
              <motion.span className="block" {...reveal(1)}>
                {FEATURE_HEADING[0]}
              </motion.span>
              <motion.span className="block" {...reveal(2)}>
                {FEATURE_HEADING[1]}
              </motion.span>
            </h2>
            <motion.p className="feature-p" {...reveal(3)}>
              {FEATURE_BODY}
            </motion.p>
          </div>

          <div ref={card} className="feature-card bg-[#242424]">
            {/* User 2026-11-05 ("glitch while changing"): every feature's copy sits in the same grid cell, so the card
                keeps one height and the old and new text cross over in place (was AnimatePresence popLayout, whose
                height jump showed one frame of overlapping text). */}
            <div className="feature-stack">
              {FEATURES.map((f, i) => (
                <div key={f.id} className="feature-copy" style={swap(i - active, 20)} aria-hidden={i !== active}>
                  <h3 className="feature-title font-dm uppercase">{f.title}</h3>
                  <p className="feature-body">{f.body}</p>
                </div>
              ))}
            </div>

            <div className="feature-foot">
              <div className="feature-stack">
                {FEATURES.map((f, i) => (
                  <ul key={f.id} className="feature-tags" style={swap(i - active, 10, 0.06)} aria-hidden={i !== active}>
                    {f.tags.map((t) => (
                      <li key={t} className="feature-tag font-dm bg-white/30 uppercase">
                        {t}
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
              <HexaMark className="feature-mark" />
            </div>
          </div>

          {/* Indicator (mockup): labels with a small square; the list slides so the active one is on the centre line,
              only its neighbours stay visible. */}
          <ol className="feature-nav font-dm uppercase" aria-label={`Feature ${active + 1} of ${FEATURES.length}`}>
            {FEATURES.map((f, i) => {
              const d = i - active;
              return (
                <li
                  key={f.id}
                  className="feature-nav-item"
                  data-active={d === 0 ? "" : undefined}
                  aria-current={d === 0 ? "step" : undefined}
                  style={{
                    transform: `translateY(calc(${d} * var(--nav-step) - 50%))`,
                    opacity: d === 0 ? 1 : Math.abs(d) === 1 ? 0.7 : 0,
                    // Hidden labels (two away) are not clickable.
                    pointerEvents: Math.abs(d) > 1 ? "none" : undefined,
                  }}
                >
                  <button
                    type="button"
                    className="feature-nav-btn"
                    onClick={() => goTo(i)}
                    aria-label={`Show ${f.nav}`}
                    aria-current={d === 0 ? "true" : undefined}
                    tabIndex={Math.abs(d) > 1 ? -1 : 0}
                  >
                    {f.nav}
                    <span className="feature-nav-sq" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </section>
    </div>
  );
}
