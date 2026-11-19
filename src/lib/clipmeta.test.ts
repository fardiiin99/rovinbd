// Run with: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sentences, trimFiller, clipTitle, keywords, hashtags, clipDescription } from './clipmeta.ts';

const CLIP = 'So um, we were talking about this earlier. Why do most people never save any money? '
  + 'Because saving money feels hard when the money is already gone. Pay yourself first, every month, '
  + 'and your savings habit grows. Habits beat motivation.';

test('sentences and trimFiller', () => {
  assert.deepEqual(sentences('One. Two? Three!'), ['One.', 'Two?', 'Three!']);
  assert.equal(trimFiller('So um, and like we went there.'), 'we went there.');
  assert.equal(trimFiller('You know what? Fine.'), 'You know what? Fine.');
});

test('clipTitle prefers a hook-like sentence over filler', () => {
  assert.equal(clipTitle(CLIP), 'Why do most people never save any money?');
  assert.equal(clipTitle('okay so this is the best tip for beginners. Thanks.'), 'This is the best tip for beginners.');
  assert.equal(clipTitle(''), '');
  const long = clipTitle(`What ${'very '.repeat(40)}long question is this?`, 60);
  assert.ok(long.length <= 60 && long.endsWith('…'), long);
});

test('keywords picks frequent meaningful words and folds plurals', () => {
  const k = keywords(CLIP, 4);
  assert.equal(k[0], 'money');
  assert.ok(k.includes('habit'), k.join(','));
  assert.ok(!k.includes('habits'));
  assert.ok(k.every((w) => !['the', 'and', 'people', 'um'].includes(w)), k.join(','));
  assert.deepEqual(keywords('the and um yeah'), []);
});

test('hashtags start with #shorts and avoid duplicates', () => {
  assert.equal(hashtags(['money', 'shorts', 'saving']), '#shorts #money #saving');
  assert.equal(hashtags([]), '#shorts');
});

test('keywords skips one-off ordinary words, tops up with specific ones', () => {
  // "feels" and "grows" are said once: not hashtag material.
  assert.deepEqual(keywords('Saving money feels hard. Money habits matter. The savings habit grows.').sort(), ['habit', 'money', 'saving']);
  // Too few repeats: long specific words fill in.
  assert.deepEqual(keywords('Our handmade bandana collection.'), ['collection', 'handmade', 'bandana']);
  assert.deepEqual(keywords('Our cool red hats.'), []);
});

test('clipDescription skips empty openers', () => {
  const d = clipDescription('So um, okay let me tell you something. Why do most people never save money? Saving money is hard.');
  assert.equal(d.split('\n\n')[0], 'Why do most people never save money? Saving money is hard.');
});

test('clipDescription: teaser, footer, hashtags', () => {
  const d = clipDescription(CLIP, 'Shop bandanas at rovinbd.com');
  const [teaser, footer, tags] = d.split('\n\n');
  assert.equal(teaser, 'We were talking about this earlier. Why do most people never save any money?');
  assert.equal(footer, 'Shop bandanas at rovinbd.com');
  assert.match(tags, /^#shorts #money/);
  assert.equal(clipDescription('', ''), '#shorts');
});
