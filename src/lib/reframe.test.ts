// Run with: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFaces, pickTargets, buildTrack, trackX, panForCenter, cropFraction, type FaceSample } from './reframe.ts';
import { coverRect } from './subtitles.ts';

const face = (cx: number, size = 0.2, score = 0.9) => ({ cx, cy: 0.4, w: size, h: size * 1.6, score });
/** Samples at 4 fps from `from` to `to` seconds, faces given by a function of time. */
function samples(from: number, to: number, f: (t: number) => ReturnType<typeof face>[]): FaceSample[] {
  const out: FaceSample[] = [];
  for (let t = from; t <= to + 1e-9; t += 0.25) out.push({ t: Math.round(t * 100) / 100, faces: f(t) });
  return out;
}

test('mergeFaces drops overlapping duplicates and keeps the confident one', () => {
  const merged = mergeFaces([face(0.3, 0.2, 0.6), face(0.31, 0.2, 0.9), face(0.8)]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((f) => f.cx < 0.5)!.score, 0.9);
});

test('pickTargets sticks with the current speaker until another is clearly bigger for a while', () => {
  // Person A (left) from the start; person B (right, much bigger) appears at 2 s.
  const s = samples(0, 5, (t) => (t < 2 ? [face(0.3)] : [face(0.3), face(0.75, 0.3)]));
  const tg = pickTargets(s, 1);
  assert.equal(tg[s.findIndex((x) => x.t === 2.5)], 0.3); // still on A (switch not held long enough)
  assert.equal(tg[s.findIndex((x) => x.t === 3.5)], 0.75); // switched after 1 s
});

test('pickTargets jumps when the current person disappears, and is null without faces', () => {
  const s = samples(0, 2, (t) => (t < 1 ? [face(0.3)] : t < 1.5 ? [] : [face(0.8)]));
  const tg = pickTargets(s);
  assert.equal(tg[0], 0.3);
  assert.equal(tg[s.findIndex((x) => x.t === 1.25)], null);
  assert.equal(tg[tg.length - 1], 0.8);
});

test('buildTrack holds still for small movement, follows drift, and cuts between people', () => {
  const cropW = 0.316; // 9:16 crop of a 16:9 frame
  // Small wobble around 0.4, then a slow drift to 0.55, then a new person at 0.85.
  const s = samples(0, 12, (t) => {
    if (t < 3) return [face(0.4 + 0.01 * Math.sin(t * 7))];
    if (t < 7) return [face(0.4 + (Math.min(t, 6) - 3) * 0.05)];
    if (t < 8) return [face(0.55)];
    return [face(0.85)];
  });
  const tr = buildTrack(s, { cropW })!;
  const at = (time: number) => trackX(tr, time);
  // Steady during wobble.
  assert.ok(Math.abs(at(0.5) - at(2.5)) < 1e-9, `${at(0.5)} vs ${at(2.5)}`);
  // Followed the drift (within the dead zone of the face).
  assert.ok(Math.abs(at(7.5) - 0.55) < cropW * 0.15 + 0.01, String(at(7.5)));
  // Cut to the new person (clamped to the frame edge) with a hard cut, not a slide.
  assert.ok(tr.cut.some(Boolean));
  const ci = tr.cut.indexOf(true);
  assert.equal(at(tr.t[ci] - 0.01), tr.x[ci - 1]);
  assert.ok(Math.abs(at(11) - Math.min(0.85, 1 - cropW / 2)) < 1e-9);
  // Never lets the crop leave the frame.
  assert.ok(tr.x.every((x) => x >= cropW / 2 - 1e-9 && x <= 1 - cropW / 2 + 1e-9));
});

test('buildTrack fills gaps and returns null when no face at all', () => {
  assert.equal(buildTrack(samples(0, 2, () => []), { cropW: 0.3 }), null);
  const tr = buildTrack(samples(0, 2, (t) => (t >= 1 ? [face(0.6)] : [])), { cropW: 0.3 })!;
  assert.equal(tr.x[0], 0.6); // leading gap takes the first known position
});

test('panForCenter puts the requested centre in the middle of the crop', () => {
  const [W, H, dw, dh] = [1920, 1080, 1080, 1920];
  for (const cx of [0.25, 0.5, 0.7]) {
    const pan = panForCenter(cx, W, H, dw, dh);
    const r = coverRect(W, H, dw, dh, pan);
    assert.ok(Math.abs((r.sx + r.sw / 2) / W - cx) < 1e-9, `cx ${cx}`);
  }
  assert.equal(panForCenter(0, W, H, dw, dh), -1); // clamped at the left edge
  assert.equal(panForCenter(1, W, H, dw, dh), 1);
  assert.equal(panForCenter(0.3, 1080, 1920, 1080, 1920), 0); // nothing to pan
  assert.ok(Math.abs(cropFraction(W, H, dw, dh) - 0.31640625) < 1e-9);
  assert.equal(cropFraction(1080, 1920, 1080, 1920), 1);
});
