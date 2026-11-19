import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { authUrl, redirectUriFor, youtubeConfigured } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sends the admin to Google to allow uploads to their YouTube channel. */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.redirect(new URL('/admin/login', req.url));
  if (!youtubeConfigured()) return NextResponse.redirect(new URL('/admin/clipper?youtube=not-configured', req.url));
  const state = randomBytes(16).toString('hex');
  const res = NextResponse.redirect(authUrl(redirectUriFor(req), state));
  // Ties Google's answer to this browser, so a forged callback can't connect another account.
  res.cookies.set('yt_oauth_state', state, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/api/admin/youtube', maxAge: 600,
  });
  return res;
}
