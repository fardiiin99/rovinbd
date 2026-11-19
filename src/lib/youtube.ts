// YouTube channel connection and uploads for the video clipper, via the official
// YouTube Data API v3. Needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (an OAuth "Web
// application" client with the YouTube Data API enabled). The refresh token is stored
// encrypted in the database; access tokens live only in memory.

import { sql } from './pg';
import { seal, unseal } from './secretbox';
import { buildVideoResource, type ShortMeta } from './shorts';

const AUTH_URL = process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_BASE = process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com';
const API_BASE = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const SECRET = process.env.AUTH_SECRET || 'dev-secret-change-me-please-this-is-long-enough';

export const youtubeConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

/**
 * The OAuth callback address. It must match an "Authorized redirect URI" in Google Cloud
 * exactly; YOUTUBE_REDIRECT_URI overrides it if the site sits behind an unusual proxy.
 */
export function redirectUriFor(req: Request): string {
  if (process.env.YOUTUBE_REDIRECT_URI) return process.env.YOUTUBE_REDIRECT_URI;
  const url = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
  const proto = req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '');
  return `${proto}://${host}/api/admin/youtube/callback`;
}

export type Channel = { id: string; title: string; thumbnail: string };
export type UploadRecord = { videoId: string; title: string; privacy: string; publishAt: number | null; createdAt: number };

// ---------- storage ----------

let tablesReady: Promise<void> | null = null;
function tables() {
  tablesReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS youtube_account (
      id integer PRIMARY KEY, refresh_token text NOT NULL, channel_id text NOT NULL,
      channel_title text NOT NULL, channel_thumb text DEFAULT '', connected_at bigint NOT NULL
    )`;
    await sql`CREATE TABLE IF NOT EXISTS youtube_uploads (
      video_id text PRIMARY KEY, title text NOT NULL, privacy text NOT NULL,
      publish_at bigint, created_at bigint NOT NULL
    )`;
  })().catch((e) => { tablesReady = null; throw e; });
  return tablesReady;
}

export async function getChannel(): Promise<Channel | null> {
  await tables();
  const { rows } = await sql`SELECT channel_id, channel_title, channel_thumb FROM youtube_account WHERE id = 1`;
  if (!rows[0]) return null;
  return { id: rows[0].channel_id, title: rows[0].channel_title, thumbnail: rows[0].channel_thumb || '' };
}

export async function listUploads(limit = 30): Promise<UploadRecord[]> {
  await tables();
  const { rows } = await sql`SELECT video_id, title, privacy, publish_at, created_at FROM youtube_uploads ORDER BY created_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    videoId: r.video_id, title: r.title, privacy: r.privacy,
    publishAt: r.publish_at != null ? Number(r.publish_at) : null, createdAt: Number(r.created_at),
  }));
}

// ---------- OAuth ----------

export function authUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent', // always return a refresh token
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${p}`;
}

async function tokenRequest(body: Record<string, string>) {
  const r = await fetch(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      ...body,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Google sign-in failed (${r.status})`);
  return j as { access_token: string; expires_in: number; refresh_token?: string };
}

let cachedToken: { token: string; until: number } | null = null;

async function fetchChannel(accessToken: string): Promise<Channel> {
  const r = await fetch(`${API_BASE}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `Could not read the channel (${r.status})`);
  const c = j.items?.[0];
  if (!c) throw new Error('This Google account has no YouTube channel. Create one on YouTube first.');
  return { id: c.id, title: c.snippet?.title || 'YouTube channel', thumbnail: c.snippet?.thumbnails?.default?.url || '' };
}

/** Finishes "Connect YouTube": trades the code for tokens and saves the channel. */
export async function connect(code: string, redirectUri: string): Promise<Channel> {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!t.refresh_token) throw new Error('Google did not return a refresh token. Remove the app from your Google account permissions and connect again.');
  const channel = await fetchChannel(t.access_token);
  await tables();
  const sealed = seal(t.refresh_token, SECRET, 'youtube');
  await sql`INSERT INTO youtube_account (id, refresh_token, channel_id, channel_title, channel_thumb, connected_at)
    VALUES (1, ${sealed}, ${channel.id}, ${channel.title}, ${channel.thumbnail}, ${Date.now()})
    ON CONFLICT (id) DO UPDATE SET refresh_token = EXCLUDED.refresh_token, channel_id = EXCLUDED.channel_id,
      channel_title = EXCLUDED.channel_title, channel_thumb = EXCLUDED.channel_thumb, connected_at = EXCLUDED.connected_at`;
  cachedToken = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
  return channel;
}

async function refreshToken(): Promise<string> {
  await tables();
  const { rows } = await sql`SELECT refresh_token FROM youtube_account WHERE id = 1`;
  if (!rows[0]) throw new Error('No YouTube channel is connected.');
  const rt = unseal(rows[0].refresh_token, SECRET, 'youtube');
  if (!rt) throw new Error('The saved YouTube connection can no longer be read (was AUTH_SECRET changed?). Connect the channel again.');
  return rt;
}

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.until > Date.now()) return cachedToken.token;
  const t = await tokenRequest({ refresh_token: await refreshToken(), grant_type: 'refresh_token' }).catch((e: Error) => {
    if (/invalid_grant/i.test(e.message)) throw new Error('YouTube access was removed or expired. Connect the channel again.');
    throw e;
  });
  cachedToken = { token: t.access_token, until: Date.now() + (t.expires_in - 60) * 1000 };
  return t.access_token;
}

export async function disconnect() {
  try {
    const rt = await refreshToken();
    await fetch(`${OAUTH_BASE}/revoke?token=${encodeURIComponent(rt)}`, { method: 'POST' }).catch(() => {});
  } catch { /* nothing saved */ }
  await tables();
  await sql`DELETE FROM youtube_account WHERE id = 1`;
  cachedToken = null;
}

// ---------- upload ----------

function apiError(status: number, j: { error?: { message?: string; errors?: { reason?: string }[] } }) {
  const reason = j.error?.errors?.[0]?.reason || '';
  if (reason === 'quotaExceeded' || reason === 'uploadLimitExceeded')
    return 'YouTube’s daily upload limit for this app is used up. Try again tomorrow.';
  if (reason === 'youtubeSignupRequired') return 'This Google account has no YouTube channel yet.';
  if (status === 401) return 'YouTube access expired. Connect the channel again.';
  return j.error?.message || `YouTube refused the upload (${status}).`;
}

/** Uploads one video with YouTube's resumable upload. Returns the new video id. */
export async function uploadShort(video: Blob, meta: ShortMeta): Promise<string> {
  const token = await accessToken();
  const resource = buildVideoResource(meta);
  const start = await fetch(`${API_BASE}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': video.type || 'video/mp4',
      'x-upload-content-length': String(video.size),
    },
    body: JSON.stringify(resource),
  });
  if (!start.ok) throw new Error(apiError(start.status, await start.json().catch(() => ({}))));
  const location = start.headers.get('location');
  if (!location) throw new Error('YouTube did not start the upload.');

  const put = await fetch(location, {
    method: 'PUT',
    headers: { 'content-type': video.type || 'video/mp4', 'content-length': String(video.size) },
    body: video,
  });
  const j = await put.json().catch(() => ({}));
  if (!put.ok || !j.id) throw new Error(apiError(put.status, j));

  await tables();
  await sql`INSERT INTO youtube_uploads (video_id, title, privacy, publish_at, created_at)
    VALUES (${j.id}, ${resource.snippet.title}, ${String(resource.status.privacyStatus)}, ${meta.publishAt}, ${Date.now()})
    ON CONFLICT (video_id) DO NOTHING`;
  return j.id as string;
}
