import * as THREE from "three";

/**
 * Footer drone flight model (user, 2026-11-01): the floating and landing character of the drone on
 * https://drone.riotters.com/ ("Aevion"), studied from its shipped bundle and GLB (local scratch only, nothing copied
 * into the repo). Raven re-implements the behaviour; the landing path is a fit to the measured motion, not the source
 * keyframes. Lengths are in drone widths (reference drone ≈ 35 units across), angles in degrees, times in seconds.
 *
 * Measured in the reference:
 * - Landing: a baked clip (frames 855 → 995 at 30 fps) played over LANDING_DURATION_S 4 with ease-out-cubic once the
 *   landing section is 30% visible; replays after the section leaves. The drone glides in from far behind and above,
 *   banked (roll -31°), yawed (+21°) and nose up (-12°), growing to full size as it comes toward the camera; bank and
 *   yaw level out by 64% of the clip, pitch by 50%; then it lowers straight down onto the pad at a slowly falling speed.
 * - Float: `camera.y += sin(t · 0.3 Hz · 2π) · 1 unit` (FLOAT_FREQUENCY, FLOAT_AMPLITUDE), faded in at FLOAT_BLEND_SPEED 2.
 * - Flight follow (airborne): pointer smoothed with `1 - (1 - 0.03)^(60·dt)`; yaw x·2.5°, pitch y·4°, roll -x·3.5°
 *   (banks into the turn) and a camera-space shift of 6% / 4% of the view height.
 * - Landed tilt (from 47% of the landing on, faded in over 0.3 s): pitch y·8° + 5° bias, roll x·7°, yaw x·5°, smoothing
 *   0.04; a sideways drift toward the pointer (τ 0.4 s, up to 5 s near the screen edges) and sin(y·π/2) lift, 15% / 10%
 *   of the view height; the camera head turns with the pointer (yaw x·45°, pitch 40° down / 12° up).
 * - Propellers keep spinning after touchdown (PROPELLER_SPEED 75.4 rad/s; Raven keeps its own rotor model).
 */
export const FLIGHT = {
  landingS: 2, // was 4, 5.5, 3.4 (user 2026-11-05: smooth, not a drop; then: arrives too late; 2026-11-13: "the drone should come immediately")
  playVisible: 0.3,
  /** Share of the landing clip spent on the glide-in; the rest is the vertical let-down. */
  approachEnd: 0.64,
  pitchEnd: 0.5,
  bankDeg: -31,
  yawDeg: 21,
  pitchDeg: -12,
  /** Apparent size at the start of the glide (reference distance ratio 387.5 / 75 → 0.19). */
  startScale: 0.72, // was 0.19, .45: starts nearer, so it reads as the drone arriving at once (2026-11-13: nearer still)
  /** Height above the pad where the glide hands over to the vertical let-down (12.5 / 35). */
  letDownHeight: 0.36,
  /** Equivalent start height of the reference glide above the pad (projected at the landing distance). */
  refStartHeight: 1.13,
  floatHz: 0.3,
  /** 1 unit on a 35-unit drone. */
  floatAmp: 1 / 35,
  floatBlend: 2,
  follow: { lerp: 0.03, yawDeg: 2.5, pitchDeg: 4, rollDeg: 3.5, shiftX: 0.06 / 1.15, shiftY: 0.04 / 1.15 },
  landed: {
    lerp: 0.04,
    armSettle: 0.47,
    fadeS: 0.3,
    pitchDeg: 8,
    pitchBiasDeg: 5,
    rollDeg: 7,
    yawDeg: 5,
    /** 15% / 10% of a view height 1.15 drone widths tall. */
    shiftX: 0.15 / 1.15,
    shiftY: 0.1 / 1.15,
    driftTauS: 0.4,
    driftEdgeStart: 0.75,
    driftEdgeTauS: 5,
    driftTauBlendS: 0.15,
    headYawDeg: 45,
    headPitchDownDeg: 40,
    headPitchUpDeg: 12,
  },
} as const;

const DEG = Math.PI / 180;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent version of a per-60-fps-frame lerp factor (as the reference writes it). */
const lerpFactor = (perFrame: number, dt: number) => 1 - (1 - perFrame) ** (60 * dt);

export type LandingPose = { height: number; scale: number; yaw: number; pitch: number; roll: number };

/**
 * Landing progress for the time since the landing started. User 2026-11-05: the ease-out-cubic start (full speed on the
 * first frame) read as the drone falling. Now it eases in from rest, peaks early, and settles with a long soft tail
 * (zero speed at both ends): 1 - (1 - smoothstep(t))^2.
 */
// Feedback 2026-11-13 ("still it is taking time ... the drone should come immediately"): the smoothstep start left the
// drone almost still, small and high, for the first ~0.6 s of a 3.4 s landing. Now it moves from the first frame and
// settles softly (ease-out, power 2.4) over 2 s, from nearer and lower (START_HEIGHT in ClosingCtaDrone).
export const landingProgress = (seconds: number) => {
  const t = clamp01(seconds / FLIGHT.landingS);
  return 1 - (1 - t) ** 2.4;
};

/**
 * Pose along the landing for progress `n` (0 -> 1). One continuous descent from `startHeight` (drone widths above the
 * rest pose) to 0, so there is no speed change at a glide / let-down hand-over (the earlier two-piece path had one).
 * Size grows from far (startScale) as it comes in; bank, yaw and nose-up level out in the first part of the descent.
 */
export function landingPose(n: number, startHeight: number, out: LandingPose): LandingPose {
  out.height = startHeight * (1 - n);
  out.scale = Math.exp(Math.log(FLIGHT.startScale) * (1 - smoothstep(0, 0.85, n)));
  const level = 1 - smoothstep(0, 0.75, n);
  out.yaw = FLIGHT.yawDeg * DEG * level;
  out.roll = FLIGHT.bankDeg * DEG * level;
  out.pitch = FLIGHT.pitchDeg * DEG * (1 - smoothstep(0, 0.6, n));
  return out;
}

/** Continuous float (drone widths): one slow sine, faded in from the moment the drone appears. */
export class FloatBob {
  private t = 0;
  private w = 0;
  reset() {
    this.t = 0;
    this.w = 0;
  }
  update(dt: number) {
    this.w += (1 - this.w) * Math.min(dt * FLIGHT.floatBlend, 1);
    this.t += dt;
    return Math.sin(this.t * FLIGHT.floatHz * Math.PI * 2) * FLIGHT.floatAmp * this.w;
  }
}

const AX = new THREE.Vector3(1, 0, 0);
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const FWD = new THREE.Vector3(0, 0, -1); // camera forward (the footer cameras look down -z)
const _q = new THREE.Quaternion();

/**
 * Pointer response. `x` right-positive, `y` down-positive, both -1..1. While airborne the drone leans into the pointer
 * (flight follow); from `armSettle` of the landing it fades into the landed tilt with drift. Writes a camera-space
 * rotation offset and a shift in drone widths; `head` gives the sensor turret's yaw/pitch (radians).
 */
export class PointerLean {
  readonly offset = new THREE.Quaternion();
  readonly shift = new THREE.Vector2();
  readonly head = { yaw: 0, pitch: 0 };
  private fx = 0;
  private fy = 0;
  private lx = 0;
  private ly = 0;
  private driftX = 0;
  private driftTau: number = FLIGHT.landed.driftTauS;
  private weight = 0;

  reset() {
    this.fx = this.fy = this.lx = this.ly = this.driftX = this.weight = 0;
    this.driftTau = FLIGHT.landed.driftTauS;
    this.offset.identity();
    this.shift.set(0, 0);
    this.head.yaw = this.head.pitch = 0;
  }

  update(dt: number, x: number, y: number, settle: number) {
    const F = FLIGHT.follow;
    const L = FLIGHT.landed;
    const fa = lerpFactor(F.lerp, dt);
    this.fx += (x - this.fx) * fa;
    this.fy += (y - this.fy) * fa;
    const la = lerpFactor(L.lerp, dt);
    this.lx += (x - this.lx) * la;
    this.ly += (y - this.ly) * la;
    // Drift: follows the pointer with τ 0.4 s, slowing toward τ 5 s when pushing past 75% of the way to an edge.
    const toward = THREE.MathUtils.clamp(x, -1, 1) - this.driftX;
    const outward = toward * this.driftX > 0;
    const edge = clamp01((Math.abs(this.driftX) - L.driftEdgeStart) / (1 - L.driftEdgeStart));
    const tau = outward ? L.driftTauS * (L.driftEdgeTauS / L.driftTauS) ** (edge * edge * (3 - 2 * edge)) : L.driftTauS;
    this.driftTau *= (tau / this.driftTau) ** (1 - Math.exp(-dt / L.driftTauBlendS));
    this.driftX += toward * (1 - Math.exp(-dt / this.driftTau));

    this.weight = settle < L.armSettle ? 0 : Math.min(this.weight + dt / L.fadeS, 1);
    const s = this.weight;
    const f = 1 - s;

    // Landed tilt about the camera axes (pitch toward the pointer plus a small nose-down bias), then flight follow.
    this.offset.setFromAxisAngle(AY, (this.lx * L.yawDeg * s + this.fx * F.yawDeg * f) * DEG);
    this.offset.multiply(_q.setFromAxisAngle(AX, ((this.ly * L.pitchDeg + L.pitchBiasDeg) * s + this.fy * F.pitchDeg * f) * DEG));
    this.offset.multiply(_q.setFromAxisAngle(FWD, this.lx * L.rollDeg * s * DEG));
    this.offset.multiply(_q.setFromAxisAngle(AZ, -this.fx * F.rollDeg * f * DEG));

    const lift = Math.sin((THREE.MathUtils.clamp(this.ly, -1, 1) * Math.PI) / 2);
    this.shift.set(this.driftX * L.shiftX * s + this.fx * F.shiftX * f, -lift * L.shiftY * s - this.fy * F.shiftY * f);
    this.head.yaw = this.lx * L.headYawDeg * s * DEG;
    this.head.pitch = this.ly * (this.ly >= 0 ? L.headPitchDownDeg : L.headPitchUpDeg) * s * DEG;
  }
}

/**
 * Gives the hexa's EO/IR turret a pivot at the top of its mount (the GLB node sits on the model origin, so rotating it
 * directly would swing it round the airframe). Works on one RavenModel instance (its scene is cloned per instance).
 */
export function turretPivot(object: THREE.Object3D): THREE.Group | null {
  const turret = object.getObjectByName("Hexa_EOIR_Turret") as THREE.Mesh | undefined;
  const parent = turret?.parent;
  if (!turret || !parent || !turret.geometry) return null;
  if (parent.name === "TurretPivot") return parent as THREE.Group;
  turret.updateMatrix();
  turret.geometry.computeBoundingBox();
  const box = turret.geometry.boundingBox!.clone().applyMatrix4(turret.matrix);
  const centre = box.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.name = "TurretPivot";
  pivot.position.set(centre.x, box.max.y, centre.z);
  parent.add(pivot);
  turret.position.sub(pivot.position);
  pivot.add(turret);
  return pivot;
}
