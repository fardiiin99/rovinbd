import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { connect, redirectUriFor } from '@/lib/youtube';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Google sends the admin back here after they allow (or refuse) access. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const back = (status: string, message?: string) => {
    const to = new URL('/admin/clipper', req.url);
    to.searchParams.set('youtube', status);
    if (message) to.searchParams.set('message', message.slice(0, 300));
    const res = NextResponse.redirect(to);
    res.cookies.delete({ name: 'yt_oauth_state', path: '/api/admin/youtube' });
    return res;
  };
  if (!(await getSession())) return NextResponse.redirect(new URL('/admin/login', req.url));
  const expected = (await cookies()).get('yt_oauth_state')?.value;
  if (!expected || url.searchParams.get('state') !== expected) return back('error', 'The sign-in link expired. Try connecting again.');
  if (url.searchParams.get('error')) return back('error', 'Access to YouTube was not allowed.');
  const code = url.searchParams.get('code');
  if (!code) return back('error', 'Google did not send a sign-in code.');
  try {
    await connect(code, redirectUriFor(req));
    return back('connected');
  } catch (e) {
    return back('error', e instanceof Error ? e.message : 'Could not connect the channel.');
  }
}
