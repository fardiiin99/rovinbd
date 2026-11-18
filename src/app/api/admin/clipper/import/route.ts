import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { parseVideoLink } from '@/lib/videolink';
import { jobView, startJob } from '@/lib/linkjobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starts downloading a YouTube or TikTok video on the server. */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const link = parseVideoLink(typeof body.url === 'string' ? body.url : '');
  if (!link) return NextResponse.json({ error: 'Paste a link to a YouTube or TikTok video.' }, { status: 400 });
  try {
    const job = await startJob(link.url);
    return NextResponse.json(jobView(job));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not start the download.' }, { status: 429 });
  }
}
