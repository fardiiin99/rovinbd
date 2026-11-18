// Finds faces in a stretch of video with MediaPipe's face detector, running in the browser.
// The library and model (≈ 0.25 MB) download from public CDNs on first use, then stay cached.

import { mergeFaces, type FaceBox, type FaceSample } from '@/lib/reframe';

const MP_VERSION = '1.2.0';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

type MpDetection = { categories: { score: number }[]; boundingBox?: { originX: number; originY: number; width: number; height: number } };
type MpDetector = { detect(img: HTMLCanvasElement): { detections: MpDetection[] } };

/** Turns one image into face boxes. Swappable so tests can run without the real model. */
export type FaceDetectFn = (img: HTMLCanvasElement) => FaceBox[];
export type FaceDetectorLoader = () => Promise<FaceDetectFn>;

let cached: Promise<FaceDetectFn> | null = null;

/** Loads MediaPipe's face detector once (GPU when available, CPU otherwise). */
export const loadMediapipe: FaceDetectorLoader = () => {
  if (cached) return cached;
  cached = (async () => {
    const url = `${MP_BASE}/vision_bundle.mjs`;
    const mod = await import(/* webpackIgnore: true */ url);
    const files = await mod.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    // CPU: this model is tiny, so it is fast there, and its scores are steadier than on GPU.
    const det = (await mod.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.5,
    })) as MpDetector;
    return (img: HTMLCanvasElement) =>
      det.detect(img).detections.flatMap((d) => {
        const b = d.boundingBox;
        if (!b) return [];
        return [{
          cx: (b.originX + b.width / 2) / img.width,
          cy: (b.originY + b.height / 2) / img.height,
          w: b.width / img.width,
          h: b.height / img.height,
          score: d.categories[0]?.score ?? 0,
        }];
      });
  })();
  cached.catch(() => { cached = null; });
  return cached;
};

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    const done = () => { v.removeEventListener('seeked', done); resolve(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

/** Start positions for overlapping windows of `side` along `len`, the last one flush with the end. */
function positions(len: number, side: number) {
  if (side >= len) return [0];
  const out: number[] = [];
  for (let p = 0; p + side < len; p += side / 2) out.push(p);
  out.push(len - side);
  return out;
}

/**
 * The detector is a close-range model, so in a wide shot a face is too small for it.
 * Look at the whole frame plus overlapping squares at two zoom levels (full height and
 * half height), which makes faces 2–4× bigger to the model.
 */
function detectTiled(detect: FaceDetectFn, frame: HTMLCanvasElement, tile: HTMLCanvasElement): FaceBox[] {
  const W = frame.width;
  const H = frame.height;
  const faces: FaceBox[] = [...detect(frame)];
  const tctx = tile.getContext('2d', { willReadFrequently: true })!;
  const base = Math.min(W, H);
  for (const side of [base, base / 2]) {
    for (const y of positions(H, side)) {
      for (const x of positions(W, side)) {
        if (side === base && W === H) continue; // same as the whole frame
        tctx.drawImage(frame, x, y, side, side, 0, 0, tile.width, tile.height);
        for (const f of detect(tile)) {
          faces.push({
            cx: (x + f.cx * side) / W,
            cy: (y + f.cy * side) / H,
            w: (f.w * side) / W,
            h: (f.h * side) / H,
            score: f.score,
          });
        }
      }
    }
  }
  return mergeFaces(faces.filter((f) => f.score >= 0.6));
}

/** Samples [start, end] at `fps` and returns the faces found at each moment. */
export async function scanFaces(
  src: string,
  start: number,
  end: number,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
  loader: FaceDetectorLoader = loadMediapipe,
  fps = 4,
): Promise<FaceSample[]> {
  const detect = await loader();
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = src;
  await new Promise<void>((resolve, reject) => {
    v.onloadeddata = () => resolve();
    v.onerror = () => reject(new Error('Could not read the video for face tracking.'));
  });
  const frame = document.createElement('canvas');
  const scale = Math.min(1, 960 / Math.max(v.videoWidth, v.videoHeight));
  frame.width = Math.round(v.videoWidth * scale);
  frame.height = Math.round(v.videoHeight * scale);
  const tile = document.createElement('canvas');
  tile.width = tile.height = 320;
  const fctx = frame.getContext('2d', { willReadFrequently: true })!;

  const out: FaceSample[] = [];
  const step = 1 / fps;
  const total = Math.max(1, Math.ceil((end - start) / step));
  try {
    for (let i = 0; i <= total; i++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = Math.min(end, start + i * step);
      await seek(v, t);
      fctx.drawImage(v, 0, 0, frame.width, frame.height);
      out.push({ t, faces: detectTiled(detect, frame, tile) });
      onProgress((i + 1) / (total + 1));
    }
  } finally {
    v.removeAttribute('src');
    v.load();
  }
  return out;
}
