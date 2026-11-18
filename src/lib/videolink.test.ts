// Run with: npm test  (Node's built-in runner; no extra dependencies)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoLink, parseProgress, friendlyError, fileNameFromTitle } from './videolink.ts';

test('accepts YouTube links in their common forms and cleans them', () => {
  assert.deepEqual(parseVideoLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&si=abc'), { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', site: 'youtube' });
  assert.equal(parseVideoLink('youtu.be/dQw4w9WgXcQ?si=xyz')?.url, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(parseVideoLink('  https://youtube.com/shorts/abc123DEF  ')?.url, 'https://youtube.com/shorts/abc123DEF');
  assert.equal(parseVideoLink('http://m.youtube.com/watch?v=abc&t=42')?.url, 'https://m.youtube.com/watch?v=abc&t=42');
  assert.equal(parseVideoLink('https://www.youtube.com/live/xyz789')?.site, 'youtube');
});

test('accepts TikTok links', () => {
  assert.deepEqual(parseVideoLink('https://www.tiktok.com/@someone/video/7312345678901234567?is_from_webapp=1'), { url: 'https://www.tiktok.com/@someone/video/7312345678901234567', site: 'tiktok' });
  assert.equal(parseVideoLink('vm.tiktok.com/ZMabc123/')?.site, 'tiktok');
});

test('rejects anything that is not a YouTube or TikTok video', () => {
  for (const bad of [
    '', 'hello', 'https://example.com/watch?v=abc', 'https://youtube.com.evil.com/watch?v=abc',
    'https://www.youtube.com/', 'https://www.youtube.com/@channel', 'file:///etc/passwd',
    'https://user:pw@youtube.com/watch?v=abc', 'https://youtube.com:8080/watch?v=abc',
    'javascript:alert(1)', 'https://www.youtube.com/watch?v=a b',
  ]) assert.equal(parseVideoLink(bad), null, bad);
});

test('parseProgress reads yt-dlp progress lines', () => {
  assert.equal(parseProgress('PROGRESS:  42.5%'), 42.5);
  assert.equal(parseProgress('PROGRESS: 100.0%'), 100);
  assert.equal(parseProgress('[download] Destination: x'), null);
});

test('friendlyError explains common failures', () => {
  assert.match(friendlyError("ERROR: [youtube] abc: Sign in to confirm you're not a bot."), /blocked/);
  assert.match(friendlyError('ERROR: [youtube] abc: Private video. Sign in if you have access'), /private/);
  assert.match(friendlyError('ERROR: [youtube] abc: Video unavailable'), /unavailable/);
  assert.match(friendlyError('abc does not pass filter (duration<=10800 & !is_live), skipping ..'), /too long/);
  assert.match(friendlyError('ERROR: something odd happened'), /something odd happened/);
});

test('fileNameFromTitle makes safe names', () => {
  assert.equal(fileNameFromTitle('Ep. 12: "Money" / Habits?'), 'Ep. 12 Money Habits.mp4');
  assert.equal(fileNameFromTitle('   '), 'video.mp4');
});
