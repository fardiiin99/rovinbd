// Face-following reframe ("auto reframe"): turns per-frame face detections into a smooth
// virtual-camera path for cropping wide video to vertical. Pure functions, no DOM.

/**
 * One detected face, in 0–1 coordinates of the source frame. `mouth` is how open the mouth
 * is (lip gap ÷ face height), when it could be measured.
 */
export type FaceBox = { cx: number; cy: number; w: number; h: number; score: number; mouth?: number };
export type FaceSample = { t: number; faces: FaceBox[] };

/**
 * Crop-centre path: x in 0–1 of the source width, at ascending times. `cut[i]` = hard cut into
 * sample i. `mode` says whether it followed the active speaker or just the main face.
 */
export type Track = { t: number[]; x: number[]; cut: boolean[]; mode: 'speaker' | 'face' };

export type SpeakerOptions = {
  /** Seconds of mouth movement to look at around each moment. */
  window?: number;
  /** Minimum average mouth change per sample to count as talking. */
  minActivity?: number;
  /** How long a new speaker must keep talking before the camera switches. */
  switchHold?: number;
  /** Whether anyone is speaking at time t (e.g. from the transcript). Unknown = assume yes. */
  speechAt?: (t: number) => boolean;
};

/** Links faces across samples into people by position. Returns a person id per face per sample. */
export function linkPeople(samples: FaceSample[], maxJump = 0.1): number[][] {
  const lastX: number[] = [];
  return samples.map((s) => {
    const taken = new Set<number>();
    // Bigger faces claim their person first.
    const order = s.faces.map((_, i) => i).sort((a, b) => area(s.faces[b]) - area(s.faces[a]));
    const ids: number[] = new Array(s.faces.length);
    for (const i of order) {
      const f = s.faces[i];
      let best = -1;
      let bestD = maxJump;
      lastX.forEach((x, p) => {
        const d = Math.abs(x - f.cx);
        if (!taken.has(p) && d < bestD) { best = p; bestD = d; }
      });
      if (best < 0) { best = lastX.length; lastX.push(f.cx); }
      lastX[best] = f.cx;
      taken.add(best);
      ids[i] = best;
    }
    return ids;
  });
}

/**
 * Picks who is talking in each sample: the person whose mouth moves the most over a short
 * window, clearly more than anyone else, while speech is heard. The camera stays on the
 * current speaker through pauses and overlaps, and switches only once a new speaker has
 * talked for `switchHold` seconds. Returns the target x per sample (null = no face).
 */
export function speakerTargets(samples: FaceSample[], opts: SpeakerOptions = {}): (number | null)[] {
  const { window = 1, minActivity = 0.012, switchHold = 0.5, speechAt } = opts;
  const ids = linkPeople(samples);

  // Mouth readings per person over time.
  const series = new Map<number, { t: number; m: number }[]>();
  samples.forEach((s, i) => s.faces.forEach((f, j) => {
    if (f.mouth === undefined) return;
    const list = series.get(ids[i][j]) ?? [];
    list.push({ t: s.t, m: f.mouth });
    series.set(ids[i][j], list);
  }));
  // Average change between neighbouring readings: high while talking, near zero when still.
  const activity = (p: number, t: number) => {
    const pts = (series.get(p) ?? []).filter((x) => Math.abs(x.t - t) <= window / 2);
    if (pts.length < 3) return 0;
    let sum = 0;
    for (let k = 1; k < pts.length; k++) sum += Math.abs(pts[k].m - pts[k - 1].m);
    return sum / (pts.length - 1);
  };

  let cur: number | null = null;
  let pend: number | null = null;
  let pendT = 0;
  return samples.map((s, i) => {
    if (!s.faces.length) return null;
    const people = ids[i];
    const xOf = (p: number) => s.faces[people.indexOf(p)]?.cx;

    let talker: number | null = null;
    if (!speechAt || speechAt(s.t)) {
      const acts = people.map((p) => ({ p, a: activity(p, s.t) })).sort((a, b) => b.a - a.a);
      if (acts[0] && acts[0].a >= minActivity && (!acts[1] || acts[0].a >= acts[1].a * 1.3)) talker = acts[0].p;
    }

    if (cur === null || !people.includes(cur)) {
      // Nobody chosen yet, or the current person left the frame: take the talker, else the biggest face.
      const biggest = people[s.faces.indexOf(s.faces.reduce((a, b) => (area(b) > area(a) ? b : a)))];
      cur = talker ?? biggest;
      pend = null;
    } else if (talker !== null && talker !== cur) {
      if (pend !== talker) { pend = talker; pendT = s.t; }
      if (s.t - pendT >= switchHold) { cur = talker; pend = null; }
    } else {
      pend = null;
    }
    return xOf(cur) ?? null;
  });
}

/** True when the samples carry mouth readings for more than one person (speaker mode is possible). */
export function hasSpeakerData(samples: FaceSample[]) {
  return samples.some((s) => s.faces.filter((f) => f.mouth !== undefined).length >= 2);
}

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
  /** Whether anyone is speaking at time t; used to ignore mouth movement during silence. */
  speechAt?: (t: number) => boolean;
};

/**
 * Builds a camera path that follows the chosen face: holds still while the face stays
 * inside a central dead zone, eases toward it when it drifts, and cuts when the target
 * jumps (a different person). Returns null if no face was ever found.
 */
export function buildTrack(samples: FaceSample[], opts: TrackOptions): Track | null {
  const { cropW, tau = 0.45, switchHold = 1, speechAt } = opts;
  if (!samples.length) return null;
  // With mouth readings for two or more people, follow whoever is talking.
  const mode: Track['mode'] = hasSpeakerData(samples) ? 'speaker' : 'face';
  const raw = mode === 'speaker' ? speakerTargets(samples, { speechAt }) : pickTargets(samples, switchHold);
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
  return { t, x, cut, mode };
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
