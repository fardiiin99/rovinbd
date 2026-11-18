// Helpers for importing a video from a YouTube or TikTok link (downloaded on the server
// with yt-dlp). Pure functions, no I/O, so they run in Node tests.

export type VideoSite = 'youtube' | 'tiktok';

const HOSTS: Record<string, VideoSite> = {
  'youtube.com': 'youtube',
  'www.youtube.com': 'youtube',
  'm.youtube.com': 'youtube',
  'music.youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'tiktok.com': 'tiktok',
  'www.tiktok.com': 'tiktok',
  'm.tiktok.com': 'tiktok',
  'vm.tiktok.com': 'tiktok',
  'vt.tiktok.com': 'tiktok',
};

/**
 * Accepts a pasted YouTube or TikTok link (with or without https://) and returns a clean
 * https URL, or null for anything else. Only these sites are allowed, so the server never
 * fetches arbitrary addresses.
 */
export function parseVideoLink(input: string): { url: string; site: VideoSite } | null {
  let raw = input.trim();
  if (!raw || raw.length > 2000 || /\s/.test(raw)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password || u.port) return null;
  const site = HOSTS[u.hostname.toLowerCase()];
  if (!site) return null;
  u.protocol = 'https:';
  u.hash = '';
  if (site === 'youtube') {
    // Keep only the video id (and start time); drop playlist and tracking parameters.
    const keep = new URLSearchParams();
    const v = u.searchParams.get('v');
    if (v) keep.set('v', v);
    const t = u.searchParams.get('t');
    if (t) keep.set('t', t);
    u.search = keep.toString();
    const isVideo = u.hostname === 'youtu.be' ? u.pathname.length > 1 : !!v || /^\/(shorts|live|embed)\/[\w-]+/.test(u.pathname);
    if (!isVideo) return null;
  } else {
    u.search = '';
  }
  return { url: u.toString(), site };
}

/** Reads a percentage from a yt-dlp progress line ("PROGRESS: 42.5%"), or null. */
export function parseProgress(line: string): number | null {
  const m = line.match(/PROGRESS:\s*([\d.]+)%/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
}

/** Turns yt-dlp's error output into a message a person can act on. */
export function friendlyError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes('sign in to confirm') || s.includes('not a bot'))
    return "YouTube blocked the download from the server (it thinks it's a bot). Try again later, or download the video yourself and upload the file.";
  if (s.includes('private video') || s.includes('login required') || s.includes('members-only'))
    return 'This video is private or needs a login, so it cannot be downloaded.';
  if (s.includes('video unavailable') || s.includes('not available') || s.includes('404'))
    return 'This video is unavailable. Check the link.';
  if (s.includes('does not pass filter') || (s.includes('skipping') && s.includes('duration')))
    return 'This video is too long (the limit is 3 hours) or is a live stream.';
  if (s.includes('larger than max-filesize') || s.includes('file is larger'))
    return 'This video is too big to import (the limit is 3 GB).';
  if (s.includes('unable to download') || s.includes('connection') || s.includes('timed out'))
    return 'The server could not reach the video site. Try again in a minute.';
  const last = stderr.trim().split('\n').filter(Boolean).pop() ?? '';
  return `The video could not be downloaded. ${last.replace(/^ERROR:\s*/, '').slice(0, 200)}`.trim();
}

/** A safe file name from a video title. */
export function fileNameFromTitle(title: string, ext = 'mp4'): string {
  const base = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'video'}.${ext}`;
}
