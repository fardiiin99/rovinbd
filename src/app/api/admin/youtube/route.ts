import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { disconnect, getChannel, listUploads, redirectUriFor, youtubeConfigured } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Connection status, the channel, and recent uploads. */
export async function GET(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const configured = youtubeConfigured();
  const redirectUri = redirectUriFor(req);
  if (!configured) return NextResponse.json({ configured, redirectUri, channel: null, uploads: [] });
  try {
    const [channel, uploads] = await Promise.all([getChannel(), listUploads()]);
    return NextResponse.json({ configured, redirectUri, channel, uploads });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not read the YouTube settings.' }, { status: 500 });
  }
}

/** Disconnects the channel and revokes the app's access. */
export async function DELETE() {
  if (!(await getSession())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  await disconnect();
  return NextResponse.json({ ok: true });
}
