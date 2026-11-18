// Face-following reframe ("auto reframe"): turns per-frame face detections into a smooth
// virtual-camera path for cropping wide video to vertical. Pure functions, no DOM.

/** One detected face, in 0–1 coordinates of the source frame. */
export type FaceBox = { cx: number; cy: number; w: number; h: number; score: number };
export type FaceSample = { t: number; faces: FaceBox[] };

/** Crop-centre path: x in 0–1 of the source width, at ascending times. `cut[i]` = hard cut into sample i. */
export type Track = { t: number[]; x: number[]; cut: boolean[] };

const area = (f: FaceBox) => f.w * f.h;

function iou(a: FaceBox, b: FaceBox) {
  const x1 = Math.max(a.cx - a.w / 2, b.cx - b.w / 2);
  const x2 = Math.min(a.cx + a.w / 2, b.cx + b.w / 2);
  const y1 = Math.max(a.cy - a.h / 2, b.cy - b.h / 2);
  const y2 = Math.min(a.cy + a.h / 2, b.cy + b.h / 2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

/** Merges duplicate detections (e.g. from overlapping tiles), keeping the most confident. */
export function mergeFaces(faces: FaceBox[], threshold = 0.3): FaceBox[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score);
  const out: FaceBox[] = [];
  for (const f of sorted) if (!out.some((o) => iou(o, f) > threshold)) out.push(f);
  return out;
}

/**
 * Chooses which face to follow in each sample. Sticks with the current person unless
 * another face is clearly bigger (closer / the main speaker) for at least `switchHold` seconds,
 * or the current person disappears. Returns the target x (0–1) or null when no face.
 */
export function pickTargets(samples: FaceSample[], switchHold = 1): (number | null)[] {
  let cur: number | null = null;
  let pend: number | null = null;
  let pendT = 0;
  return samples.map((s) => {
    if (!s.faces.length) return null;
    const best = s.faces.reduce((a, b) => (area(b) > area(a) ? b : a));
    if (cur === null) return (cur = best.cx);
    const c: number = cur;
    const near = s.faces.reduce((a, b) => (Math.abs(b.cx - c) < Math.abs(a.cx - c) ? b : a));
    const nearOk = Math.abs(near.cx - c) < 0.15;
    if (nearOk && (best === near || area(best) < area(near) * 1.5)) {
      pend = null;
      return (cur = near.cx);
    }
    if (!nearOk) {
      pend = null;
      return (cur = best.cx);
    }
    if (pend === null || Math.abs(pend - best.cx) > 0.15) {
      pend = best.cx;
      pendT = s.t;
    }
    if (s.t - pendT >= switchHold) {
      pend = null;
      return (cur = best.cx);
    }
    return (cur = near.cx);
  });
}

export type TrackOptions = {
  /** Width of the crop window as a fraction of the source width (0–1]. */
  cropW: number;
  /** Smoothing time constant in seconds: higher = slower, steadier camera. */
  tau?: number;
  switchHold?: number;
};

/**
 * Builds a camera path that follows the chosen face: holds still while the face stays
 * inside a central dead zone, eases toward it when it drifts, and cuts when the target
 * jumps (a different person). Returns null if no face was ever found.
 */
export function buildTrack(samples: FaceSample[], opts: TrackOptions): Track | null {
  const { cropW, tau = 0.45, switchHold = 1 } = opts;
  if (!samples.length) return null;
  const raw = pickTargets(samples, switchHold);
  const firstKnown = raw.find((x) => x !== null);
  if (firstKnown === undefined || firstKnown === null) return null;

  // Fill gaps by holding the last known position.
  let last: number = firstKnown;
  const filled = raw.map((x) => (x === null ? last : (last = x)));

  // Median of 5 removes single-frame detector glitches.
  const med = filled.map((_, i) => {
    const w = filled.slice(Math.max(0, i - 2), i + 3).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });

  const half = Math.min(0.5, cropW / 2);
  const clampX = (x: number) => Math.max(half, Math.min(1 - half, x));
  const dead = cropW * 0.15;
  const cutAt = cropW * 0.6;

  const t = samples.map((s) => s.t);
  const x: number[] = [];
  const cut: boolean[] = [];
  let cam = clampX(med[0]);
  med.forEach((target, i) => {
    const goal = clampX(target);
    const d = goal - cam;
    let isCut = false;
    if (i > 0 && Math.abs(d) > cutAt) {
      cam = goal;
      isCut = true;
    } else if (Math.abs(d) > dead) {
      const dt = i > 0 ? t[i] - t[i - 1] : 0;
      const k = 1 - Math.exp(-dt / tau);
      cam += (d - Math.sign(d) * dead * 0.5) * k;
    }
    x.push(cam);
    cut.push(isCut);
  });
  return { t, x, cut };
}

/** Camera x at time `time`, interpolated; a cut switches instantly at its sample time. */
export function trackX(track: Track, time: number): number {
  const { t, x, cut } = track;
  if (time <= t[0]) return x[0];
  if (time >= t[t.length - 1]) return x[x.length - 1];
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid;
  }
  if (cut[hi]) return x[lo];
  const f = (time - t[lo]) / (t[hi] - t[lo] || 1);
  return x[lo] + (x[hi] - x[lo]) * f;
}

/** Converts a crop-centre x (0–1 of source width) into the pan value coverRect expects (-1…1). */
export function panForCenter(cx: number, srcW: number, srcH: number, dstW: number, dstH: number): number {
  const target = dstW / dstH;
  const sw = srcW / srcH > target ? srcH * target : srcW;
  const range = srcW - sw;
  if (range <= 0) return 0;
  const sx = Math.max(0, Math.min(range, cx * srcW - sw / 2));
  return sx / (range / 2) - 1;
}

/** Crop width as a fraction of source width for a destination box (1 = no horizontal crop). */
export function cropFraction(srcW: number, srcH: number, dstW: number, dstH: number): number {
  if (!srcW || !srcH || !dstW || !dstH) return 1;
  const target = dstW / dstH;
  return srcW / srcH > target ? (srcH * target) / srcW : 1;
}
