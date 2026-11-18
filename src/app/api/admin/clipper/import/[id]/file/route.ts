import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { fileNameFromTitle } from '@/lib/videolink';
import { getJob, removeJob } from '@/lib/linkjobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Streams the downloaded video to the browser once, then deletes it from the server. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await params;
  const job = getJob(id);
  if (!job || job.status !== 'ready' || !job.file) {
    return NextResponse.json({ error: 'This video is not ready.' }, { status: 404 });
  }
  const stream = createReadStream(job.file);
  const cleanup = () => { void removeJob(id); };
  stream.on('close', cleanup);
  stream.on('error', cleanup);
  const name = fileNameFromTitle(job.title, job.file.split('.').pop() || 'mp4');
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      'Content-Type': job.file.endsWith('.webm') ? 'video/webm' : 'video/mp4',
      'Content-Length': String(job.size ?? ''),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Video-Title': encodeURIComponent(job.title || 'video'),
      'Cache-Control': 'no-store',
    },
  });
}
