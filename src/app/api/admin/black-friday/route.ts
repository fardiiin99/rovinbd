import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/auth';

const validTime = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : null;

export async function PUT(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json();
  const startsAt = validTime(body.startsAt);
  const endsAt = validTime(body.endsAt);
  if (startsAt != null && endsAt != null && endsAt <= startsAt) {
    return NextResponse.json({ error: 'The end time must be after the start time.' }, { status: 400 });
  }
  const saved = await db.updateBlackFridayCampaign({ enabled: body.enabled === true, startsAt, endsAt });
  return NextResponse.json(saved);
}
