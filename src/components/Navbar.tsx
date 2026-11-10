"use client";

import clsx from "clsx";
import { useLenis } from "lenis/react";
import { motion } from "motion/react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type TouchEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useLoading } from "@/lib/loading";
import { SCENE, sceneEndOffset, useScenes, type SceneId } from "@/lib/scenes";
import { toPage, useStage } from "@/lib/story-map";
import { isScrollLocked, lockScroll, unlockScroll } from "@/lib/scroll-lock";
import { useMediaQuery } from "@/lib/use-media-query";
import { ContactButton } from "./ContactButton";
import { CONCEPT_NOTICE } from "@/lib/copy";
import { CloseIcon, MenuIcon } from "./ui/icons";

/** Chapter targets in order (shipped `O` in layout module 72781); Raven display labels. Story bands: story-map.ts. */
const CHAPTERS: [SceneId, string][] = [
  [SCENE.DELTA_DRONE, "Airframe"],
  [SCENE.SWARM_SCENE, "Connection"],
  [SCENE.MISSION_PRESET, "Prepare"],
  [SCENE.REAL_TIME_DETECTION, "Route"],
  [SCENE.PHALANX_AI, "Care teams"],
  // Review, Updates, Support and Network removed (user, 2026-11-03): the story ends on the Care teams landscape.
];

/** In-page destinations (the shipped menu linked to other products). `null` = top of the story. */
// Every section of the page in order (feedback 2026-11-10: "the menu on the right side needs to be updated"; it only
// reached the 3D story): the story frames, then Sections 03-05 (Section 03's band top is its first feature stop).
// Contact (last item, all sizes) opens the contact modal like the bar's button.
const MENU_LINKS: { label: string; target: string | null }[] = [
  { label: "The delivery story", target: null },
  { label: "Payload", target: "#payload" },
  { label: "Altitude", target: "#route" },
  { label: "Speed", target: "#speed" },
  { label: "Hardware", target: "#features-band" },
  { label: "Capabilities", target: "#capabilities" },
  { label: "Use cases", target: "#use-cases" },
];

/** Chapter ticks (Airframe ... Care teams) are off: those chapters are no longer on the page. */
const SHOW_CHAPTER_TICKS = false;

const FADE_MS = 150;
const SCROLL_S = 0.75;

function ChapterTab({ name, isActive, onHover, onClick, setRef }: { name: string; isActive: boolean; onHover: () => void; onClick: () => void; setRef: (el: HTMLButtonElement | null) => void }) {
  const measure = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const md = useMediaQuery("(min-width: 768px)");
  useLayoutEffect(() => {
    const on = () => setWidth(measure.current ? measure.current.offsetWidth + (md ? 12 : 16) : 0);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [md]);
  return (
    <>
      <span ref={measure} className="text-m-mono md:text-d-mono invisible absolute font-mono whitespace-nowrap uppercase" aria-hidden="true">
        {name}
      </span>
      <button
        ref={setRef}
        type="button"
        className="cursor-pointer px-2 select-none md:px-3"
        onMouseEnter={onHover}
        onFocus={onHover}
        onClick={onClick}
        aria-label={`Go to ${name}`}
        aria-current={isActive ? "step" : undefined}
      >
        <motion.div
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: isActive ? width : 0, opacity: isActive ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          className="relative flex h-4 items-center overflow-hidden"
        >
          <span className="text-m-mono md:text-d-mono absolute top-1/2 left-1/2 inline-block -translate-x-1/2 -translate-y-1/2 font-mono !text-[0.8125rem] whitespace-nowrap uppercase">
            {name}
          </span>
        </motion.div>
      </button>
    </>
  );
}

/** Centered chapter ticks with hover reveal + fade/scroll/restore navigation. */
function ChapterNav() {
  const lenis = useLenis();
  const coarse = useMediaQuery("(pointer: coarse)");
  const [hovered, setHovered] = useState<SceneId | null>(null);
  const [touched, setTouched] = useState<SceneId | null>(null);
  const [touching, setTouching] = useState(false);
  const [pending, setPending] = useState<SceneId | null>(null);
  const [busy, setBusy] = useState(false);
  const refs = useRef<Partial<Record<SceneId, HTMLButtonElement | null>>>({});
  const t1 = useRef<number | null>(null);
  const t2 = useRef<number | null>(null);

  const current = useScenes(
    useShallow((s) => {
      let id: SceneId | null = null;
      for (const [scene] of CHAPTERS) if (s[scene]?.progress > 0) id = scene;
      // Route starts with the village scan, inside the (removed) Journey range at .85 (ChapterCopy, DetectionPoints).
      if (id === SCENE.MISSION_PRESET && s[SCENE.FLOCK_SCENE].progress > 0.85) id = SCENE.REAL_TIME_DETECTION;
      return id;
    }),
  );
  const leaving = useScenes((s) => s[SCENE.MULTI_THREAT_RESPONSE].hideRatio > 0);
  const offStage = useStage((s) => s.cover < 0.5); // after the story (team section)
  const active = pending ?? touched ?? hovered ?? current ?? CHAPTERS[0][0];

  const clear = useCallback(() => {
    if (t1.current !== null) window.clearTimeout(t1.current);
    if (t2.current !== null) window.clearTimeout(t2.current);
    t1.current = t2.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const go = useCallback(
    (id: SceneId) => {
      if (busy || id === current) return;
      const container = document.getElementById("scene-container");
      if (!container) return;
      const target = toPage(sceneEndOffset(id, window.innerHeight));
      setPending(id);
      setBusy(true);
      setHovered(null);
      setTouched(null);
      setTouching(false);
      clear();
      container.style.transition = `opacity ${FADE_MS}ms ease-in-out`;
      container.style.opacity = "0";
      t1.current = window.setTimeout(() => {
        lenis?.scrollTo(target, { duration: SCROLL_S });
        t2.current = window.setTimeout(() => {
          requestAnimationFrame(() => (container.style.opacity = "1"));
          setBusy(false);
          setPending(null);
        }, SCROLL_S * 1000);
      }, FADE_MS);
    },
    [busy, current, lenis, clear],
  );

  const nearest = useCallback((x: number, y: number) => {
    let best: { id: SceneId; d: number } | null = null;
    for (const [id] of CHAPTERS) {
      const el = refs.current[id];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
      const d = Math.abs(r.left + r.width / 2 - x);
      if (!best || d < best.d) best = { id, d };
    }
    return best?.id ?? null;
  }, []);
  const track = (e: TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    const id = nearest(t.clientX, t.clientY);
    if (id) setTouched(id);
  };

  return (
    <nav
      aria-label="Chapters"
      data-nav-touch="1"
      className={clsx(
        "z-navbar pointer-events-none absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 transform items-center opacity-0 transition-opacity",
        current && !leaving && !offStage && "opacity-100",
        !busy && current && !leaving && !offStage && "pointer-events-auto!",
        coarse && "touch-none",
      )}
      onMouseLeave={() => !busy && setHovered(null)}
      onTouchStart={(e) => {
        if (!coarse || busy) return;
        setTouching(true);
        track(e);
      }}
      onTouchMove={(e) => {
        if (!coarse || !touching || busy) return;
        e.preventDefault();
        track(e);
      }}
      onTouchEnd={() => {
        if (!coarse || !touching || busy) return;
        if (touched) go(touched);
        setTouching(false);
        setTouched(null);
      }}
    >
      {CHAPTERS.map(([id, name], i) => (
        <Fragment key={id}>
          <ChapterTab
            name={name}
            isActive={active === id}
            onHover={() => !coarse && !busy && setHovered(id)}
            onClick={() => !coarse && !busy && go(id)}
            setRef={(el) => {
              refs.current[id] = el;
            }}
          />
          {i < CHAPTERS.length - 1 && (
            <div className="w-0" aria-hidden="true">
              <div className="h-1.5 w-px bg-white/50" />
            </div>
          )}
        </Fragment>
      ))}
    </nav>
  );
}

function MenuToggle({ open }: { open: boolean }) {
  return (
    <div className="relative size-7">
      <div className="absolute top-1/2 left-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center">
        {open ? (
          <CloseIcon className="size-6 text-white transition-colors hover:text-white/80" />
        ) : (
          <MenuIcon className="size-7 text-white transition-colors hover:text-white/80" />
        )}
      </div>
    </div>
  );
}

/** Right-side sheet menu (shipped `T`); native <dialog> for focus trap + Escape. */
function Menu() {
  const lenis = useLenis();
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open || !lenis) return;
    lockScroll(lenis);
    return () => unlockScroll(lenis);
  }, [open, lenis]);
  const close = () => dialog.current?.close();
  // Jump once the dialog's scroll lock is released (unlock runs in the effect cleanup after close).
  const go = (target: string | null) => {
    close();
    window.setTimeout(() => lenis?.scrollTo(target ?? 1, { immediate: true }), 50);
  };
  return (
    <>
      <button
        type="button"
        className="grid h-full w-[var(--nav-height)] cursor-pointer place-items-center border-l border-[var(--bar-line)] bg-[#0b0c0b] focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white"
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          dialog.current?.showModal();
          setOpen(true);
        }}
      >
        <MenuToggle open={false} />
      </button>
      <dialog
        ref={dialog}
        aria-label="Menu"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        className="z-menu fixed inset-0 m-0 h-svh max-h-none w-full max-w-none bg-black/50 text-white [&:not([open])]:hidden"
      >
        <div
          className={clsx(
            "fixed top-0 right-0 bottom-0 flex h-svh w-full flex-col border-l border-white/20 bg-black/70 backdrop-blur-xl transition-transform duration-500 md:max-w-79",
            open ? "translate-x-0" : "translate-x-full",
          )}
        >
          <div className="text-d-body-l flex h-[var(--nav-height)] w-full items-center justify-end px-4 text-white/70 md:px-8">
            <button type="button" onClick={close} aria-label="Close menu" className="cursor-pointer">
              <MenuToggle open />
            </button>
          </div>
          <div className="flex flex-1 flex-col px-4 py-6 md:px-8">
            <ul className="flex flex-col gap-1">
              {MENU_LINKS.map((l) => (
                <li key={l.label}>
                  <button
                    type="button"
                    onClick={() => go(l.target)}
                    className="text-d-cta block w-fit cursor-pointer py-3 text-white transition-colors duration-200 hover:text-white/50"
                  >
                    {l.label}
                  </button>
                </li>
              ))}
              <li>
                <ContactButton
                  label="Contact"
                  trigger={
                    <button type="button" className="text-d-cta block w-fit py-3 text-white transition-colors duration-200 hover:text-white/50">
                      Contact
                    </button>
                  }
                />
              </li>
            </ul>
            <div className="mt-auto border-t border-white/10 pt-5">
              <p className="text-d-cta text-white">A design concept</p>
              <p className="text-d-body-s mt-1 leading-6 text-white/65">{CONCEPT_NOTICE}</p>
            </div>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Hexacopter mark + wordmark (asset/html/raven_homepage.html `.brand`); the word hides on narrow portrait after 40px scroll. */
function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-white" aria-label="Raven">
      <svg viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true" className="size-[1.625rem] flex-none">
        <circle cx="13" cy="13" r="3.2" />
        <g strokeLinecap="round">
          <line x1="13" y1="9.8" x2="13" y2="4.6" />
          <line x1="13" y1="16.2" x2="13" y2="21.4" />
          <line x1="10.2" y1="11.4" x2="5.9" y2="8.9" />
          <line x1="15.8" y1="14.6" x2="20.1" y2="17.1" />
          <line x1="15.8" y1="11.4" x2="20.1" y2="8.9" />
          <line x1="10.2" y1="14.6" x2="5.9" y2="17.1" />
        </g>
        <circle cx="13" cy="3.2" r="1.5" />
        <circle cx="13" cy="22.8" r="1.5" />
        <circle cx="4.6" cy="8.2" r="1.5" />
        <circle cx="21.4" cy="17.8" r="1.5" />
        <circle cx="21.4" cy="8.2" r="1.5" />
        <circle cx="4.6" cy="17.8" r="1.5" />
      </svg>
      <span className={clsx("text-[clamp(1.125rem,1.45vw,1.4375rem)] leading-none font-semibold tracking-[-0.04em] uppercase", collapsed && "portrait:max-[480px]:hidden")}>
        Raven
      </span>
    </span>
  );
}

const barText = "text-[clamp(0.6875rem,0.78vw,0.78125rem)] leading-none font-medium tracking-[0.02em] uppercase opacity-90 transition-opacity hover:opacity-100 hover:underline hover:underline-offset-[5px] focus-visible:opacity-100";

/**
 * Homepage bar (asset/html/raven_homepage.html `.bar`): brand | boxed Contact cell | black menu square, one
 * hairline under it. The story's chapter ticks stay centred in the bar (shipped fade/scroll/restore navigation).
 */
export function Navbar() {
  const lenis = useLenis(({ scroll }) => {
    if (!isScrollLocked()) setCollapsed(scroll > 40);
  });
  const [collapsed, setCollapsed] = useState(false);
  const multi = useScenes((s) => s[SCENE.MULTI_THREAT_RESPONSE]?.hideRatio ?? 0);
  const cover = useStage((s) => s.cover);
  const bg = Math.max(multi, 1 - cover); // solid bar over the page sections, clear over the story stage
  const hiding = useLoading((s) => s.loadingCanvasIsHiding);
  return (
    <nav
      aria-label="Primary"
      className={clsx(
        "z-navbar fixed top-0 grid h-[var(--nav-height)] w-full grid-cols-[1fr_auto_var(--nav-height)] border-b border-[var(--bar-line)] text-white max-[640px]:grid-cols-[1fr_var(--nav-height)]",
        "transition-opacity delay-200 duration-700 ease-out",
        hiding ? "opacity-100" : "pointer-events-none opacity-0",
        "before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:bg-black before:opacity-[var(--bg-opacity)]",
      )}
      style={{ "--bg-opacity": bg } as React.CSSProperties}
    >
      {/* Bar links (Story, Payload, Altitude, Speed) removed (user, 2026-11-05); the menu keeps its links. */}
      <div className="flex min-w-0 items-center gap-[clamp(1.25rem,2.6vw,2.5rem)] pl-[clamp(1.125rem,2.2vw,2.25rem)]">
        <button
          type="button"
          className="flex-none cursor-pointer"
          aria-label="Raven, back to top"
          onClick={() => {
            lenis?.scrollTo(1, { immediate: true });
            lenis?.stop();
            setTimeout(() => lenis?.start(), 2);
          }}
        >
          <Logo collapsed={collapsed} />
        </button>
      </div>
      {SHOW_CHAPTER_TICKS && <ChapterNav />}
      <ContactButton
        label="Contact"
        trigger={
          <button
            type="button"
            className={clsx(barText, "flex h-full cursor-pointer items-center justify-center border-l border-[var(--bar-line)] px-[clamp(1.75rem,4.2vw,4.375rem)] max-[640px]:hidden")}
          >
            Contact
          </button>
        }
      />
      <Menu />
    </nav>
  );
}
