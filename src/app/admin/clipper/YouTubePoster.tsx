'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { notShortReason, planSchedule, scheduleProblem, shortTitle, type Privacy } from '@/lib/shorts';
import { clipDescription, clipTitle, keywords } from '@/lib/clipmeta';

export type PostItem = {
  id: string;
  title: string;
  seconds: number;
  /** What is said in the clip; used to write its title, description and hashtags. */
  text?: string;
  /** The exported video, once it exists. */
  result?: { url: string; ext: string; size: number };
};

type Status = {
  configured: boolean;
  redirectUri: string;
  channel: { id: string; title: string; thumbnail: string } | null;
  uploads: { videoId: string; title: string; privacy: string; publishAt: number | null; createdAt: number }[];
};
type PostState = { state: 'waiting' | 'posting' | 'done' | 'error'; progress: number; url?: string; publishAt?: number | null; error?: string };

const AUTO_KEY = 'clipper:yt-auto';
const FOOTER_KEY = 'clipper:yt-footer';
const TAGS_KEY = 'clipper:yt-tags';
const pad = (n: number) => String(n).padStart(2, '0');
/** datetime-local value for tomorrow at 18:00 in the browser's time zone. */
function tomorrowSix() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T18:00`;
}
const when = (t: number) => new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Uploads with progress (fetch can't report upload progress). */
function send(form: FormData, onProgress: (f: number) => void) {
  return new Promise<{ id: string; url: string }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/admin/youtube/upload');
    x.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    x.onload = () => {
      let j: { id?: string; url?: string; error?: string } = {};
      try { j = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300 && j.id) resolve({ id: j.id, url: j.url || `https://youtube.com/shorts/${j.id}` });
      else reject(new Error(j.error || `Upload failed (${x.status}).`));
    };
    x.onerror = () => reject(new Error('Network error while uploading. Check your connection and try again.'));
    x.send(form);
  });
}

export default function YouTubePoster({ items, outW, outH, busy }: { items: PostItem[]; outW: number; outH: number; busy?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState('');
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [privacy, setPrivacy] = useState<Privacy>('public');
  const [mode, setMode] = useState<'now' | 'spread'>('spread');
  const [firstAt, setFirstAt] = useState(tomorrowSix);
  const [everyHours, setEveryHours] = useState(24);
  const [footer, setFooter] = useState('');
  const [tags, setTags] = useState('');
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [openDesc, setOpenDesc] = useState('');
  const [posts, setPosts] = useState<Record<string, PostState>>({});
  const [auto, setAuto] = useState(false);
  const [problem, setProblem] = useState('');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const slots = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/youtube', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not load the YouTube settings.');
      setStatus(j);
      setLoadError('');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    try {
      setAuto(localStorage.getItem(AUTO_KEY) === '1');
      setFooter(localStorage.getItem(FOOTER_KEY) ?? '');
      setTags(localStorage.getItem(TAGS_KEY) ?? '');
    } catch { /* ignore */ }
    // Result of "Connect YouTube" comes back in the address bar.
    const p = new URLSearchParams(window.location.search);
    const yt = p.get('youtube');
    if (yt) {
      setBanner(yt === 'connected'
        ? { ok: true, text: 'YouTube channel connected.' }
        : { ok: false, text: p.get('message') || (yt === 'not-configured' ? 'YouTube posting is not set up on the server yet.' : 'Could not connect YouTube.') });
      p.delete('youtube');
      p.delete('message');
      const q = p.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? `?${q}` : ''));
    }
  }, [refresh]);

  useEffect(() => { try { localStorage.setItem(AUTO_KEY, auto ? '1' : '0'); } catch { /* ignore */ } }, [auto]);
  useEffect(() => { try { localStorage.setItem(FOOTER_KEY, footer); localStorage.setItem(TAGS_KEY, tags); } catch { /* ignore */ } }, [footer, tags]);

  const firstMs = new Date(firstAt).getTime();
  const tagList = tags.split(/[,\s]+/).map((t) => t.replace(/^#/, '')).filter(Boolean);
  // Written from each clip's own words; anything edited by hand wins.
  const wordsOf = (it: PostItem) => keywords(it.text || it.title, 5);
  const titleOf = (it: PostItem) => titles[it.id] ?? ((it.text && clipTitle(it.text)) || it.title);
  const descOf = (it: PostItem) => descs[it.id] ?? clipDescription(it.text || '', footer, wordsOf(it));
  const tagsOf = (it: PostItem) => [...wordsOf(it), ...tagList];

  /** Posts one item at the given publish time; queued so uploads go one at a time. */
  const post = (it: PostItem, publishAt: number | null) => {
    if (!it.result) return;
    const meta = { title: titleOf(it), description: descOf(it), tags: tagsOf(it), privacy, publishAt };
    setPosts((p) => ({ ...p, [it.id]: { state: 'waiting', progress: 0, publishAt } }));
    queue.current = queue.current.then(async () => {
      setPosts((p) => ({ ...p, [it.id]: { state: 'posting', progress: 0, publishAt } }));
      try {
        const blob = await (await fetch(it.result!.url)).blob();
        const form = new FormData();
        form.append('video', blob, `${it.id}.${it.result!.ext}`);
        form.append('meta', JSON.stringify(meta));
        const r = await send(form, (f) => setPosts((p) => ({ ...p, [it.id]: { ...p[it.id], progress: f } })));
        setPosts((p) => ({ ...p, [it.id]: { state: 'done', progress: 1, url: r.url, publishAt } }));
      } catch (e) {
        setPosts((p) => ({ ...p, [it.id]: { state: 'error', progress: 0, publishAt, error: e instanceof Error ? e.message : String(e) } }));
      }
    }).then(refresh);
  };

  const ready = items.filter((it) => it.result && !posts[it.id]);

  const postMany = (list: PostItem[]) => {
    const times = planSchedule(list.length, mode, firstMs + slots.current * everyHours * 3600_000, everyHours);
    const p = scheduleProblem(times);
    if (p) return setProblem(p);
    setProblem('');
    list.forEach((it, i) => post(it, times[i]));
    if (mode === 'spread') slots.current += list.length;
  };

  // "Post automatically after export": each newly exported clip takes the next time slot.
  const readyKey = ready.map((r) => r.id).join(',');
  useEffect(() => {
    if (!auto || !status?.channel || !readyKey) return;
    postMany(ready);
  }, [auto, status?.channel, readyKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const disconnect = async () => {
    await fetch('/api/admin/youtube', { method: 'DELETE' });
    setBanner({ ok: true, text: 'YouTube channel disconnected.' });
    refresh();
  };

  const wide = notShortReason(outW, outH, 0);

  return (
    <section className="card p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="font-semibold text-lg">Post to YouTube Shorts</h2>
          <p className="text-sm text-stone-600">Upload exported clips to your channel now, or schedule them and let YouTube publish them on time.</p>
        </div>
        {status?.channel && (
          <div className="flex items-center gap-2 text-sm">
            {status.channel.thumbnail && <img src={status.channel.thumbnail} alt="" className="w-7 h-7 rounded-full" />}
            <span className="font-medium">{status.channel.title}</span>
            <button className="btn btn-ghost text-xs py-1 px-2" onClick={disconnect}>Disconnect</button>
          </div>
        )}
      </div>

      {banner && (
        <div className={`rounded-md border p-2.5 text-sm ${banner.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>{banner.text}</div>
      )}
      {loadError && <div className="rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">{loadError}</div>}

      {!status ? (
        !loadError && <p className="text-sm text-stone-500">Checking the YouTube connection…</p>
      ) : !status.configured ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-2">
          <p className="font-medium">YouTube posting needs a one-time setup on the server.</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>In Google Cloud Console, create a project and enable <b>YouTube Data API v3</b>.</li>
            <li>Set up the OAuth consent screen, then create an OAuth client of type <b>Web application</b>.</li>
            <li>Add this as an Authorized redirect URI: <code className="break-all bg-white/70 px-1 rounded">{status.redirectUri}</code></li>
            <li>In Coolify, add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>, then redeploy.</li>
          </ol>
        </div>
      ) : !status.channel ? (
        <div className="flex flex-wrap items-center gap-3">
          <a href="/api/admin/youtube/connect" className="btn btn-primary">Connect YouTube channel</a>
          <span className="text-sm text-stone-600">You will sign in with Google and allow uploads.</span>
        </div>
      ) : (
        <>
          <fieldset disabled={busy} className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="yt-privacy">Visibility</label>
              <select id="yt-privacy" className="input" value={privacy} onChange={(e) => setPrivacy(e.target.value as Privacy)}>
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <span className="label">When</span>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button className={`btn text-sm py-1.5 px-3 ${mode === 'now' ? 'btn-primary' : 'btn-outline'}`} aria-pressed={mode === 'now'} onClick={() => setMode('now')}>Post now</button>
                <button className={`btn text-sm py-1.5 px-3 ${mode === 'spread' ? 'btn-primary' : 'btn-outline'}`} aria-pressed={mode === 'spread'} onClick={() => setMode('spread')}>Schedule</button>
                {mode === 'spread' && (
                  <>
                    <span>first at</span>
                    <input aria-label="First post date and time" type="datetime-local" className="input py-1.5 w-auto" value={firstAt} onChange={(e) => { setFirstAt(e.target.value); slots.current = 0; }} />
                    <span>then one every</span>
                    <input aria-label="Hours between posts" type="number" min={1} max={168} className="input py-1.5 w-20" value={everyHours} onChange={(e) => setEveryHours(Math.max(1, Number(e.target.value) || 24))} />
                    <span>hours</span>
                  </>
                )}
              </div>
              {mode === 'spread' && privacy !== 'public' && <p className="text-xs text-stone-500 mt-1">Scheduled posts go public at their time.</p>}
            </div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="yt-desc">Add to every description</label>
              <textarea id="yt-desc" className="input min-h-[3.5rem] text-sm" value={footer} onChange={(e) => setFooter(e.target.value)} placeholder="Shop the bandana at rovinbd.com" />
              <p className="text-xs text-stone-500 mt-1">Each clip gets its own description and hashtags written from what is said in it; this line goes between them.</p>
            </div>
            <div>
              <label className="label" htmlFor="yt-tags">Extra tags for every clip</label>
              <input id="yt-tags" className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="bandana, style, fashion" />
              <p className="text-xs text-stone-500 mt-1">Added to each clip&apos;s own tags. #Shorts is always added.</p>
            </div>
          </fieldset>

          {wide && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2.5">{wide} Change the aspect ratio in the Frame panel before exporting.</p>}
          {problem && <p className="text-sm text-red-700">{problem}</p>}

          {!items.length ? (
            <p className="text-sm text-stone-500">Generate or export clips above, and they will appear here.</p>
          ) : (
            <ul className="space-y-2">
              {items.map((it) => {
                const ps = posts[it.id];
                const long = it.seconds > 180 ? notShortReason(1, 2, it.seconds) : null;
                return (
                  <li key={it.id} className="rounded-md border border-stone-200 p-2.5 space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <input
                      className="input flex-1 text-sm py-1.5"
                      aria-label="YouTube title"
                      maxLength={100}
                      value={titleOf(it)}
                      onChange={(e) => setTitles((t) => ({ ...t, [it.id]: e.target.value }))}
                      disabled={!!ps && ps.state !== 'error'}
                    />
                    <div className="flex items-center gap-2 shrink-0 text-sm min-w-0 sm:w-72 justify-end">
                      {long && <span className="text-xs text-amber-700" title={long}>over 3 min</span>}
                      {!it.result ? (
                        <span className="text-xs text-stone-500">Export first</span>
                      ) : !ps || ps.state === 'error' ? (
                        <>
                          {ps?.error && <span className="text-xs text-red-700 truncate" title={ps.error}>{ps.error}</span>}
                          <button className="btn btn-outline text-xs py-1 px-2.5" disabled={busy} onClick={() => postMany([it])}>{ps ? 'Retry' : 'Post'}</button>
                        </>
                      ) : ps.state === 'waiting' ? (
                        <span className="text-xs text-stone-500">Waiting…</span>
                      ) : ps.state === 'posting' ? (
                        <div className="w-40">
                          <div className="h-1.5 rounded bg-stone-200 overflow-hidden"><div className="h-full bg-brand-600" style={{ width: `${Math.round(ps.progress * 100)}%` }} /></div>
                          <div className="text-xs text-stone-500 mt-0.5">{ps.progress < 1 ? `Uploading ${Math.round(ps.progress * 100)}%` : 'YouTube is processing…'}</div>
                        </div>
                      ) : (
                        <a href={ps.url} target="_blank" rel="noreferrer" className="text-xs text-emerald-700 hover:underline">
                          {ps.publishAt ? `Scheduled for ${when(ps.publishAt)}` : 'Posted'} ↗
                        </a>
                      )}
                    </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="text-stone-500 truncate min-w-0" title="Hashtags">
                        {['#shorts', ...wordsOf(it).map((w) => `#${w}`)].join(' ')}
                      </span>
                      <button
                        type="button"
                        className="text-brand-700 hover:underline"
                        aria-expanded={openDesc === it.id}
                        onClick={() => setOpenDesc(openDesc === it.id ? '' : it.id)}
                      >
                        {openDesc === it.id ? 'Hide description' : descs[it.id] !== undefined ? 'Description (edited)' : 'Description'}
                      </button>
                    </div>
                    {openDesc === it.id && (
                      <div className="space-y-1">
                        <textarea
                          aria-label="YouTube description"
                          className="input min-h-[6rem] text-sm"
                          maxLength={5000}
                          value={descOf(it)}
                          onChange={(e) => setDescs((d) => ({ ...d, [it.id]: e.target.value }))}
                          disabled={!!ps && ps.state !== 'error'}
                        />
                        {descs[it.id] !== undefined && (
                          <button type="button" className="text-xs text-stone-600 hover:underline" onClick={() => setDescs((d) => { const n = { ...d }; delete n[it.id]; return n; })}>
                            Go back to the automatic description
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-3">
            <button className="btn btn-primary" disabled={busy || !ready.length} onClick={() => postMany(ready)}>
              {mode === 'now' ? 'Post' : 'Schedule'} {ready.length || ''} {ready.length === 1 ? 'Short' : 'Shorts'}
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-brand-600" />
              Post automatically after export
            </label>
            {ready.length > 0 && mode === 'spread' && Number.isFinite(firstMs) && (
              <span className="text-xs text-stone-500">
                Next: {when(firstMs + slots.current * everyHours * 3600_000)}, then every {everyHours} h
              </span>
            )}
          </div>

          {status.uploads.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-stone-600">Recent posts ({status.uploads.length})</summary>
              <ul className="mt-2 space-y-1">
                {status.uploads.map((u) => (
                  <li key={u.videoId} className="flex flex-wrap gap-x-2">
                    <a href={`https://youtube.com/shorts/${u.videoId}`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline truncate max-w-[60ch]">{u.title}</a>
                    <span className="text-stone-500">{u.publishAt ? `goes live ${when(u.publishAt)}` : `${u.privacy}, ${when(u.createdAt)}`}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-stone-500">
            Until Google approves your app in its free API audit, YouTube keeps uploads private. Each upload uses about 1,600 of the
            10,000 daily API units, so about 6 posts a day by default. Titles get #Shorts added: “{shortTitle('Your title')}”.
          </p>
        </>
      )}
    </section>
  );
}
