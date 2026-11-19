// Run with: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortTitle, shortDescription, buildVideoResource, planSchedule, scheduleProblem, notShortReason } from './shorts.ts';
import { seal, unseal } from './secretbox.ts';

test('shortTitle adds #Shorts, strips angle brackets and keeps within 100 characters', () => {
  assert.equal(shortTitle('Why <most> people never save'), 'Why most people never save #Shorts');
  assert.equal(shortTitle('Already tagged #shorts'), 'Already tagged #shorts');
  assert.equal(shortTitle('   '), 'New video #Shorts');
  const long = shortTitle('word '.repeat(40));
  assert.ok(long.length <= 100, String(long.length));
  assert.ok(long.endsWith('… #Shorts'));
});

test('shortDescription always mentions #Shorts and stays under 5000 characters', () => {
  assert.equal(shortDescription(''), '#Shorts');
  assert.equal(shortDescription('Shop at rovinbd.com <today>'), 'Shop at rovinbd.com today\n\n#Shorts');
  assert.equal(shortDescription('x #Shorts'), 'x #Shorts');
  assert.ok(shortDescription('a'.repeat(6000)).length <= 5000);
});

test('buildVideoResource: posting now uses the chosen privacy', () => {
  const r = buildVideoResource({ title: 'Hi', description: '', privacy: 'unlisted', publishAt: null, tags: ['#bandana', 'style', 'shorts'] });
  assert.equal(r.status.privacyStatus, 'unlisted');
  assert.equal(r.status.publishAt, undefined);
  assert.deepEqual(r.snippet.tags, ['shorts', 'bandana', 'style']);
  assert.equal(r.snippet.categoryId, '22');
});

test('buildVideoResource: a scheduled post is private with an ISO publish time', () => {
  const at = Date.UTC(2026, 11, 1, 12, 0, 0);
  const r = buildVideoResource({ title: 'Hi', description: '', privacy: 'public', publishAt: at });
  assert.equal(r.status.privacyStatus, 'private');
  assert.equal(r.status.publishAt, '2026-12-01T12:00:00.000Z');
});

test('planSchedule spreads posts and scheduleProblem checks they are in the future', () => {
  const t0 = Date.UTC(2026, 11, 1, 12);
  assert.deepEqual(planSchedule(3, 'spread', t0, 24), [t0, t0 + 86400e3, t0 + 2 * 86400e3]);
  assert.deepEqual(planSchedule(2, 'now', t0, 24), [null, null]);
  assert.equal(scheduleProblem([null, null], t0), null);
  assert.equal(scheduleProblem([t0 + 3600e3], t0), null);
  assert.match(scheduleProblem([t0 + 60e3], t0)!, /10 minutes/);
  assert.match(scheduleProblem([NaN], t0)!, /Pick/);
});

test('notShortReason flags wide or long clips', () => {
  assert.equal(notShortReason(1080, 1920, 45), null);
  assert.equal(notShortReason(1080, 1080, 180), null);
  assert.match(notShortReason(1920, 1080, 30)!, /wider/);
  assert.match(notShortReason(1080, 1920, 200)!, /3 minutes/);
});

test('seal/unseal round-trips and rejects tampering or the wrong secret', () => {
  const s = seal('1//refresh-token-example', 'secret-a', 'youtube');
  assert.notEqual(s, '1//refresh-token-example');
  assert.equal(unseal(s, 'secret-a', 'youtube'), '1//refresh-token-example');
  assert.equal(unseal(s, 'secret-b', 'youtube'), null);
  assert.equal(unseal(s, 'secret-a', 'other'), null);
  const parts = s.split('.');
  parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('A') ? 'BB' : 'AA');
  assert.equal(unseal(parts.join('.'), 'secret-a', 'youtube'), null);
  assert.equal(unseal('garbage', 'secret-a'), null);
});
