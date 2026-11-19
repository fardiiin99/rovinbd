import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { scheduleProblem, type Privacy } from '@/lib/shorts';
import { uploadShort } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_BYTES = 512 * 1024 * 1024;

/** Posts one exported clip to the connected YouTube channel. Form fields: video, meta (JSON). */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'The upload was cut off. Try again.' }, { status: 400 });
  }
  const video = form.get('video');
  if (!(video instanceof Blob) || !video.size) return NextResponse.json({ error: 'No video was sent.' }, { status: 400 });
  if (video.size > MAX_BYTES) return NextResponse.json({ error: 'This clip is too big to post (over 512 MB).' }, { status: 413 });

  let meta: Record<string, unknown>;
  try {
    meta = JSON.parse(String(form.get('meta') || '{}'));
  } catch {
    return NextResponse.json({ error: 'Bad post details.' }, { status: 400 });
  }
  const privacy: Privacy = meta.privacy === 'unlisted' || meta.privacy === 'private' ? meta.privacy : 'public';
  const publishAt = typeof meta.publishAt === 'number' && Number.isFinite(meta.publishAt) ? meta.publishAt : null;
  const problem = scheduleProblem([publishAt]);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const id = await uploadShort(video, {
      title: String(meta.title || ''),
      description: String(meta.description || ''),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String).slice(0, 30) : [],
      privacy,
      publishAt,
    });
    return NextResponse.json({ id, url: `https://youtube.com/shorts/${id}` });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The upload failed.' }, { status: 502 });
  }
}
