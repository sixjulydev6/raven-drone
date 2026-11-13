/**
 * Copy for the sections after the 3D stage (user's Figma, file "Drone Website", 2026-11-04):
 * Section 03 = frames 128:804 / 128:830 / 128:857 (one feature each, switched by scroll),
 * Section 04 = frame 100:622 (capability videos, played one after another).
 * The Figma frames repeat one placeholder card ("Sealed motor pods", Propulsion / Status LED); only frame 3 shows a
 * motor pod, so the first two cards are titled after their own image (parts of the hexa model, no performance claims).
 */

/** Copy from the user's mockups (2026-11-06). */
export const SECTION_KICKER = "Capability";
export const SECTION_HEADING = "Sense. Stabilise. Navigate.";
export const SECTION_BODY =
  "Terrain-aware sensing, active crosswind compensation and autonomous route planning, working as one system through canyons, ridgelines and gusting wind.";

/** Section 03 heading (user mockups 2026-11-05, "Feature 7/8" frames); Section 04 keeps SECTION_HEADING above. */
export const FEATURE_KICKER = "Hardware";
export const FEATURE_HEADING = ["Engineered for Performance.", "Built for Reliability."] as const;
export const FEATURE_BODY =
  "Carbon structure build, stabilised sensing and sealed propulsion, each specified for high-altitude, all-weather operation.";

/**
 * `nav`: the right-hand indicator label. `frame`: desktop nudge of the render (translate %, scale). Renders: the user's
 * raven-drone-site/src/hardware/hardware-1..3.png (2026-11-05; transparent PNGs flattened on black, max 2560 wide,
 * WebP q86; hardware-2's transparent left band, 428 px, trimmed).
 */
export type Feature = {
  id: string;
  nav: string;
  title: string;
  body: string;
  tags: string[];
  image: string;
  alt: string;
  frame: { x: number; y: number; s: number };
  /** Left edge where the render's content starts (% of image width): faded to black from there, hides a hard cut. */
  fadeLeft?: number;
  /**
   * Phones only: % of image height where a fade to black starts at the bottom (the render's own bottom edge cuts
   * through the object, which shows on phones where the whole render is contained). Needs the image's `aspect`.
   */
  fadeBottom?: number;
  /** Image width / height (for `fadeBottom`: the phone image box takes the render's own proportions). */
  aspect?: number;
};

/**
 * Phone-sized renders (user 2026-11-13: the Hardware images loaded very late on phones): each 2560-wide render also
 * ships 1280 wide (`<name>-1280.webp`, from the 2560 WebP, WebP q88 sharp-YUV), which covers a phone at 3x (412 CSS px
 * = 1236 px) at less than half the bytes. Desktop and large retina screens still pick the 2560 original.
 */
export const FEATURE_SIZES = "100vw";
export function featureSrcSet(f: Feature) {
  return `${f.image.replace(/\.webp$/, "-1280.webp")} 1280w, ${f.image} 2560w`;
}

/** Copy from the user's mockups (2026-11-05). */
export const FEATURES: Feature[] = [
  {
    id: "arms",
    nav: "Structure",
    title: "Carbon fibre arms",
    body: "Lightweight, high-strength carbon fibre arms provide exceptional structural rigidity and durability while reducing overall weight for efficient, stable flight.",
    tags: ["Structural strength", "Lightweight design"],
    image: "/assets/features/feature-arm.webp",
    alt: "Close-up of a woven carbon-fibre drone arm",
    frame: { x: 0, y: 0, s: 1 },
  },
  {
    id: "sensor",
    nav: "Sensor",
    title: "Stabilised optical payload",
    body: "Gimbal-stabilised optics feed live imagery to the flight system, supporting obstacle detection and precise navigation on approach.",
    tags: ["Obstacle avoidance", "Real-time vision"],
    image: "/assets/features/feature-gimbal.webp",
    alt: "The drone's optical sensor gimbal above the medical box",
    frame: { x: 5, y: 0, s: 1 }, // user 2026-11-05: a little right
    fadeBottom: 62, // user 2026-11-06: the medical box is cut at the render's bottom edge on phones
    aspect: 2560 / 1583,
  },
  {
    id: "motor",
    nav: "Motor",
    title: "Sealed motor pods",
    body: "Sealed housings shield the brushless motors from dust, moisture and cold-weather ingress, holding thrust steady in rain, dust and thin air.",
    tags: ["All-weather propulsion", "IP-rated sealing"],
    image: "/assets/features/feature-motor.webp",
    alt: "A sealed motor pod with its propeller",
    frame: { x: -4, y: -4, s: 1 },
    fadeLeft: 3.4, // hardware-3 ends in a hard vertical cut at ~3.3% (arm, rear prop); user 2026-11-05
  },
];

export type CapabilityVideo = { id: string; label: string; src: string; poster: string };

/** Section 04 tabs, in the Figma order. Clips: assets/Section 04 videos (audio stripped, they play muted). */
export const CAPABILITY_VIDEOS: CapabilityVideo[] = [
  { id: "sensor", label: "Sensor", src: "/assets/video/section04/sensor.mp4", poster: "/assets/video/section04/sensor-poster.jpg" },
  { id: "crosswind", label: "Crosswind", src: "/assets/video/section04/crosswind.mp4", poster: "/assets/video/section04/crosswind-poster.jpg" },
  { id: "autopilot", label: "Route", src: "/assets/video/section04/autopilot.mp4", poster: "/assets/video/section04/autopilot-poster.jpg" },
];
