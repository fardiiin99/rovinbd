import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ALLOWED_DAYS, buildAdsReport } from '@/lib/ads-report';
import { MetaAdsError, adsTokenSource } from '@/lib/meta-ads';

// GET /api/admin/ads?days=7[&fx=125][&fresh=1]
// The Meta ads report plus recommendations. Read-only: nothing in the ad
// account is changed from here.
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get('days'));
  const fx = Number(searchParams.get('fx')) || undefined;

  try {
    const report = await buildAdsReport(ALLOWED_DAYS.includes(days) ? days : 7, fx, searchParams.get('fresh') === '1');
    return NextResponse.json({ state: 'ok', ...report });
  } catch (err) {
    if (err instanceof MetaAdsError) {
      // A setup problem is an expected state of this page, not a server error.
      return NextResponse.json({
        state: 'setup',
        kind: err.kind,
        message: err.message,
        accounts: err.accounts || [],
        tokenSource: adsTokenSource(),
      });
    }
    console.error('Ads report failed:', err);
    return NextResponse.json({ error: (err as Error).message || 'Ads report failed' }, { status: 500 });
  }
}
