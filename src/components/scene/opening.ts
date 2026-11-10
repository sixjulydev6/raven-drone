import * as THREE from "three";
import { lerp } from "@/lib/math";
import { HANDOFF_SHARE, linearEaseOutTail } from "@/lib/payload";

/**
 * Raven opening (user, 2026-11-01; not in the shipped bundle). The page opens on a low wide-angle shot just under the
 * hovering drone, sky and far ridges behind it. Scrolling page [0, P] (story-map `openingProgress`) flies the live
 * camera up and back into the hero frame of Camera01 in one continuous move: no film, no cut, no fade.
 *
 * The path is relative to the hero pose read from the clip each frame (desktop and mobile tracks alike): spherical
 * coordinates about the point the hero camera aims at (the drone). Field of view narrows from FOV_START to the hero
 * 20 deg while the radius grows (a dolly zoom), so the drone changes size gently instead of with the lens. A barrel
 * distortion pass (PostFX `FisheyeEffect`) bends the wide start and is exactly 0 at the hero frame.
 */
export const OPENING = {
  /** Vertical field of view at the start (deg). */
  fovStart: 75,
  /** Drone screen size at the start relative to the hero frame. */
  sizeStart: 0.62,
  /** Camera elevation above the drone at the start (deg, negative = below, looking up). */
  elevationStart: -8,
  /** Lowest camera height (world Y): the low cloud layers sit at -0.5 and -1 and are one-sided from above. */
  minY: -0.42,
  /** Start azimuth relative to the hero azimuth (deg): a quarter-orbit adds parallax as the camera climbs. */
  azimuthStart: -24,
  /** Barrel distortion strength at the start (0 = rectilinear). */
  fisheyeStart: 0.32,
};

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const _fwd = new THREE.Vector3();
const _target = new THREE.Vector3();
const _rel = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qFix = new THREE.Quaternion();
const _qId = new THREE.Quaternion();

/**
 * 0..1 ease-out (user 2026-11-05: "while scrolling down there is still delay"): the camera moves with the first scroll
 * and lands at rest. Was smootherstep, which moved it ~1% over the first tenth of the scroll (~0.4 s of the 2.5 s snap)
 * on top of the snap's own ramp; the snap already eases its start (SNAP_START_MS) and brakes into the hero frame.
 */
export const openingEase = (p: number) => {
  const t = Math.min(Math.max(p, 0), 1);
  // Mostly linear (user 2026-11-06, free scroll: "still some slow, snap-like effect"): the ease-out (1-(1-t)^2.2) moved
  // the camera 3% over the last fifth of the opening, ~500 px of scroll where nothing changed before the payload stage.
  // Now 35% smootherstep: the camera answers the first scroll and keeps ~2/3 of its mean speed to the hero frame.
  // The linear part brakes to rest over the last HANDOFF_SHARE while the payload zoom speeds up over the same scroll
  // (lib/payload.ts `payloadZoomAt`), so the camera never stops dead or changes direction in one frame at the hero frame.
  return 0.65 * linearEaseOutTail(t, HANDOFF_SHARE) + 0.35 * t * t * t * (t * (6 * t - 15) + 10);
};

/** Barrel strength for an opening progress. */
export const fisheyeAt = (p: number) => OPENING.fisheyeStart * (1 - openingEase(p));

/**
 * Moves `mover` (already holding the clip's hero pose) along the opening path and sets the lens.
 * At p >= 1 the clip pose and the hero fov are left untouched.
 */
export function applyOpening(mover: THREE.Object3D, camera: THREE.PerspectiveCamera, p: number, heroFov: number) {
  if (p >= 1) {
    if (camera.fov !== heroFov) {
      camera.fov = heroFov;
      camera.updateProjectionMatrix();
    }
    return;
  }
  const u = openingEase(p);

  // Hero pose -> aim point (closest point on the hero view ray to the drone at the origin) + spherical coordinates.
  _fwd.set(0, 0, -1).applyQuaternion(mover.quaternion);
  _target.copy(mover.position).addScaledVector(_fwd, -mover.position.dot(_fwd));
  _rel.copy(mover.position).sub(_target);
  const heroR = _rel.length();
  const heroAz = Math.atan2(_rel.x, _rel.z);
  const heroEl = Math.asin(THREE.MathUtils.clamp(_rel.y / heroR, -1, 1));

  // Dolly zoom: radius follows tan(fov/2) so the drone's screen size eases from sizeStart to 1.
  const tanHero = Math.tan((heroFov / 2) * DEG);
  const tanFov = Math.exp(lerp(Math.log(Math.tan((OPENING.fovStart / 2) * DEG)), Math.log(tanHero), u));
  const r = (heroR * tanHero) / (tanFov * lerp(OPENING.sizeStart, 1, u));
  const elStart = Math.max(OPENING.elevationStart * DEG, Math.asin(THREE.MathUtils.clamp((OPENING.minY - _target.y) / r, -1, 1)));
  const el = lerp(elStart, heroEl, u);
  const az = heroAz + OPENING.azimuthStart * DEG * (1 - u);

  // Land exactly on the clip orientation. The clip has a slight roll that lookAt leaves out; it used to be blended in
  // over the last 15% of the opening (slerp to the clip, smoothstep .85 -> 1), which swung the drone up then down the
  // screen just before the hero frame and reversed it there (user feedback 2026-11-10: "jitter or lag at this exact
  // point"; measured drone screen speed +5.7 -> -8.6 -> +4.9 per 1e4 px around P). Now the clip's own offset from the
  // lookAt pose (camera-local, mostly roll) is taken at the hero pose and eased in along the whole path (u).
  _m.lookAt(mover.position, _target, UP);
  _qFix.setFromRotationMatrix(_m).invert().multiply(mover.quaternion);
  _eye.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(r).add(_target);
  _m.lookAt(_eye, _target, UP);
  _q.setFromRotationMatrix(_m).multiply(_qId.identity().slerp(_qFix, u));
  mover.position.copy(_eye);
  mover.quaternion.copy(_q);

  camera.fov = (2 * Math.atan(tanFov)) / DEG;
  camera.updateProjectionMatrix();
}
