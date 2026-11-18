import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getSession } from '@/lib/auth';
import { ALLOWED_DAYS, buildAdsReport, sendDigest } from '@/lib/ads-report';
import { MetaAdsError } from '@/lib/meta-ads';

// POST /api/admin/ads/digest?days=7
// Sends the ads summary and top recommendations to the admin Telegram chat.
//
// Callable from the admin page (session cookie) or from a scheduler with
// `Authorization: Bearer $CRON_SECRET`. The bearer path is closed unless
// CRON_SECRET is set, so adding this route exposes nothing by default.
function cronAuthorized(req: Request): boolean {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (secret.length < 16) return false;
  const given = Buffer.from(req.headers.get('authorization') || '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function POST(req: Request) {
  if (!cronAuthorized(req) && !(await getSession())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const days = Number(new URL(req.url).searchParams.get('days'));
  try {
    const report = await buildAdsReport(ALLOWED_DAYS.includes(days) ? days : 7, undefined, true);
    const sent = await sendDigest(report);
    if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });
    return NextResponse.json({ ok: true, recommendations: report.advice.recommendations.length });
  } catch (err) {
    const status = err instanceof MetaAdsError ? 400 : 500;
    return NextResponse.json({ error: (err as Error).message || 'Digest failed' }, { status });
  }
}
