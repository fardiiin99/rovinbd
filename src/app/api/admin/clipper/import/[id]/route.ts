import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getJob, jobView, removeJob } from '@/lib/linkjobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Download progress for one import. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: 'This import has expired. Paste the link again.' }, { status: 404 });
  return NextResponse.json(jobView(job));
}

/** Cancels an import and deletes its files. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  await removeJob(id);
  return NextResponse.json({ ok: true });
}
