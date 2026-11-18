// Run with: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanWords, segmentSentences, groupCaptions, pickClips, evenClips, quietCuts, computeEnergy, spreadWords, scoreWindow,
} from './autoclip.ts';
import type { Word } from './subtitles.ts';

/** Builds a transcript: each sentence spoken at `wps` words/second, `pause` seconds between sentences. */
function speak(sentences: string[], { wps = 3, pause = 0.4, at = 0 } = {}): Word[] {
  const out: Word[] = [];
  let t = at;
  for (const s of sentences) {
    for (const w of s.split(' ')) {
      out.push({ text: ` ${w}`, start: t, end: t + 1 / wps - 0.05 });
      t += 1 / wps;
    }
    t += pause;
  }
  return out;
}

test('cleanWords trims, drops empties, fixes bad ends and sorts', () => {
  const w = cleanWords([
    { text: ' world', start: 1, end: 0.5 },
    { text: ' ', start: 0.5, end: 0.6 },
    { text: ' Hello', start: 0, end: 0.4 },
  ]);
  assert.deepEqual(w.map((x) => x.text), ['Hello', 'world']);
  assert.ok(w[1].end > w[1].start);
});

test('segmentSentences splits on punctuation and long pauses', () => {
  const words = cleanWords([
    ...speak(['This is one.', 'Is this two?']),
    ...speak(['no punctuation here'], { at: 10 }),
  ]);
  const s = segmentSentences(words);
  assert.deepEqual(s.map((x) => x.text), ['This is one.', 'Is this two?', 'no punctuation here']);
});

test('groupCaptions makes short cues with word timings and no flicker gaps', () => {
  const words = cleanWords(speak(['The quick brown fox jumps over the lazy dog.', 'Wow!']));
  const cues = groupCaptions(words, { maxWords: 3 });
  assert.ok(cues.every((c) => (c.words?.length ?? 0) <= 3));
  assert.equal(cues.map((c) => c.text).join(' '), 'The quick brown fox jumps over the lazy dog. Wow!');
  assert.equal(cues[cues.length - 1].text, 'Wow!'); // break after the full stop
  for (let i = 0; i < cues.length - 1; i++) {
    const gap = cues[i + 1].start - cues[i].end;
    assert.ok(gap <= 0 || gap >= 0.35, `gap ${gap}`);
  }
});

test('pickClips returns the requested count, within duration, not overlapping, best first', () => {
  const sentences: string[] = [];
  for (let i = 0; i < 60; i++) sentences.push(`and this is filler sentence number ${i} that goes on.`);
  // A strong moment in the middle.
  sentences.splice(30, 0, 'Why do most people never save money?', 'Here is the secret nobody tells you!', 'You need to pay yourself first, every single month.');
  const words = speak(sentences);
  const duration = words[words.length - 1].end + 1;
  const clips = pickClips(words, { count: 4, minDur: 15, maxDur: 30, duration });
  assert.equal(clips.length, 4);
  for (const c of clips) {
    assert.ok(c.end - c.start >= 15 - 0.01 && c.end - c.start <= 30 + 0.01, `len ${c.end - c.start}`);
    assert.ok(c.score >= 1 && c.score <= 99);
    assert.ok(c.title.length > 0);
  }
  for (let i = 0; i < clips.length; i++)
    for (let j = i + 1; j < clips.length; j++)
      assert.ok(clips[i].end <= clips[j].start || clips[j].end <= clips[i].start, 'overlap');
  for (let i = 1; i < clips.length; i++) assert.ok(clips[i - 1].score >= clips[i].score);
  assert.match(clips[0].title, /^Why do most people never save money\?/);
});

test('pickClips fills the requested count when the clips can fit', () => {
  // 90 s of steady speech: three 15–30 s clips must fit without overlapping.
  const sentences = Array.from({ length: 40 }, (_, i) => `This is sentence ${i} of the talk.`);
  const words = speak(sentences, { pause: 0.5 });
  const duration = words[words.length - 1].end + 1;
  assert.ok(duration > 85 && duration < 120, String(duration));
  const clips = pickClips(words, { count: 3, minDur: 15, maxDur: 30, duration });
  assert.equal(clips.length, 3);
});

test('pickClips handles one very long run-on sentence and short videos', () => {
  const long = speak([Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ')]);
  const clips = pickClips(long, { count: 2, minDur: 20, maxDur: 40, duration: 100 });
  assert.ok(clips.length >= 1);
  assert.ok(clips.every((c) => c.end - c.start <= 40 + 0.5));

  const short = speak(['Just a few words here.']);
  const one = pickClips(short, { count: 3, minDur: 30, maxDur: 60, duration: 3 });
  assert.equal(one.length, 1);
});

test('no speech falls back to evenly spaced clips', () => {
  assert.deepEqual(pickClips([], { count: 3, minDur: 10, maxDur: 10, duration: 100 }).map((c) => [c.start, c.end]), [[0, 10], [45, 55], [90, 100]]);
  assert.equal(evenClips(20, 5, 10).length, 2);
  assert.deepEqual(evenClips(0, 3, 10), []);
});

test('scoreWindow rewards hooks over filler openings', () => {
  const sent = (t: string) => segmentSentences(cleanWords(speak([t])))[0];
  const hook = scoreWindow([sent('Why do you never have money at the end of the month?')]);
  const filler = scoreWindow([sent('so um and then we went to the place over there.')]);
  assert.ok(hook > filler, `${hook} vs ${filler}`);
});

test('quietCuts splits long audio at quiet points within the limit', () => {
  const hop = 0.1;
  const values = new Float32Array(1000).fill(1); // 100 s
  values[255] = 0; // quiet at 25.5 s
  const cuts = quietCuts({ hop, values }, 100, 28, 6);
  assert.equal(cuts[0], 0);
  assert.equal(cuts[cuts.length - 1], 100);
  assert.ok(Math.abs(cuts[1] - 25.5) < 0.11, String(cuts[1]));
  for (let i = 1; i < cuts.length; i++) assert.ok(cuts[i] - cuts[i - 1] <= 28 + 1e-6);
});

test('computeEnergy gives RMS per hop', () => {
  const sr = 100;
  const samples = new Float32Array(200);
  samples.fill(0.5, 100);
  const e = computeEnergy(samples, sr, 1);
  assert.deepEqual(Array.from(e.values).map((v) => Math.round(v * 100) / 100), [0, 0.5]);
});

test('spreadWords shares a chunk across its words', () => {
  const w = spreadWords(' Hello big world ', 10, 13);
  assert.deepEqual(w.map((x) => x.text), ['Hello', 'big', 'world']);
  assert.equal(w[0].start, 10);
  assert.ok(Math.abs(w[2].end - 13) < 0.02);
});
