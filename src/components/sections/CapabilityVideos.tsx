"use client";

import { useEffect, useRef, useState } from "react";
import { CAPABILITY_VIDEOS, SECTION_BODY, SECTION_HEADING, SECTION_KICKER } from "@/lib/features";
import { prefetchImages } from "@/lib/prefetch-images";

/**
 * Section 04 (Figma 100:622 "Section 4", 1920 x 1433): three tabs over one video panel. When the section comes into
 * view the active clip plays once; when it ends the next tab takes over (Sensor -> Crosswind -> Route -> Sensor; "Route" was "Auto pilot" until 2026-11-06).
 * The active tab fills left to right with the clip's playback (Figma "Rectangle 35", white 4%). Leaving the section
 * pauses; coming back resumes. A tab click jumps to that clip from its start. Reduced motion: no autoplay, a click plays.
 */
export function CapabilityVideos() {
  const section = useRef<HTMLElement>(null);
  const videos = useRef<(HTMLVideoElement | null)[]>([]);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const visible = useRef(false);
  const reduced = useRef(false);
  // Download the clips only once the section is near (it is far down the page; the active clip was fetching 1.3 MB
  // during the loader). Until then the panel is empty and not even the posters load.
  const [near, setNear] = useState(false);
  // The posters (~50 KB each) are fetched in the background after load, so the panel never shows empty (2026-11-13).
  useEffect(() => prefetchImages(CAPABILITY_VIDEOS.map((c) => ({ src: c.poster }))), []);
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        setNear(true);
        io.disconnect();
      },
      { rootMargin: "150% 0px 150% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const select = (i: number, play: boolean) => {
    activeRef.current = i;
    setActive(i);
    videos.current.forEach((v, j) => {
      if (!v) return;
      if (j === i) {
        v.currentTime = 0;
        if (play) v.play().catch(() => {});
      } else v.pause();
    });
  };

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(
      ([e]) => {
        visible.current = e.isIntersecting;
        const v = videos.current[activeRef.current];
        if (!v) return;
        if (e.isIntersecting && !reduced.current) v.play().catch(() => {});
        else if (!e.isIntersecting) v.pause();
      },
      { threshold: 0.35 },
    );
    if (section.current) io.observe(section.current);

    // Tab fill follows the active clip's playback (refs only, no React state per frame).
    let raf = 0;
    const tick = () => {
      fills.current.forEach((f, j) => {
        if (!f) return;
        const v = videos.current[j];
        const p = j === activeRef.current && v && v.duration ? v.currentTime / v.duration : 0;
        f.style.transform = `scaleX(${p.toFixed(4)})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);

  const onEnded = (i: number) => {
    if (i !== activeRef.current) return;
    select((i + 1) % CAPABILITY_VIDEOS.length, visible.current);
  };

  return (
    <section
      ref={section}
      id="capabilities"
      aria-label="Raven capabilities"
      className="caps font-tight z-over-scroll-sequence relative w-full bg-[#060606] text-white"
    >
      <div className="caps-heading">
        <p className="section-kicker font-dm uppercase">/ {SECTION_KICKER}</p>
        <h2 className="caps-h">{SECTION_HEADING}</h2>
        <p className="caps-p">{SECTION_BODY}</p>
      </div>

      <div className="caps-body">
        <div role="tablist" aria-label="Capability videos" className="caps-tabs">
          {CAPABILITY_VIDEOS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`caps-tab-${c.id}`}
              aria-selected={i === active}
              aria-controls="caps-panel"
              onClick={() => select(i, true)}
              className="caps-tab font-dm relative overflow-hidden bg-[#242424] uppercase"
            >
              <span
                ref={(el) => {
                  fills.current[i] = el;
                }}
                aria-hidden="true"
                className="absolute inset-0 origin-left bg-white/[0.04]"
                style={{ transform: "scaleX(0)" }}
              />
              <span className="relative">{c.label}</span>
            </button>
          ))}
        </div>

        <div id="caps-panel" role="tabpanel" aria-labelledby={`caps-tab-${CAPABILITY_VIDEOS[active].id}`} className="caps-panel relative overflow-hidden border border-[#a8a8a8] bg-[#242424]">
          {CAPABILITY_VIDEOS.map((c, i) => (
            <video
              key={c.id}
              ref={(el) => {
                videos.current[i] = el;
              }}
              src={c.src}
              poster={near ? c.poster : undefined}
              muted
              playsInline
              preload={!near ? "none" : i === active ? "auto" : "metadata"}
              onEnded={() => onEnded(i)}
              aria-hidden={i !== active}
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: i === active ? 1 : 0, transition: "opacity 0.6s ease-in-out" }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
