// Planning and metadata for posting clips to YouTube as Shorts. Pure functions, no I/O.

export type Privacy = 'public' | 'unlisted' | 'private';

export type ShortMeta = {
  title: string;
  description: string;
  tags?: string[];
  privacy: Privacy;
  /** When YouTube should publish it (epoch ms). Null = publish now with `privacy`. */
  publishAt: number | null;
  madeForKids?: boolean;
};

const clean = (s: string) => s.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();

/** YouTube titles: max 100 characters, no angle brackets; adds #Shorts when it fits. */
export function shortTitle(raw: string): string {
  let t = clean(raw) || 'New video';
  const hasTag = /#shorts\b/i.test(t);
  const limit = hasTag ? 100 : 100 - ' #Shorts'.length;
  if (t.length > limit) t = `${t.slice(0, limit - 1).replace(/\s+\S*$/, '')}…`;
  return hasTag ? t : `${t} #Shorts`;
}

/** Descriptions: max 5000 characters, no angle brackets, always mentions #Shorts. */
export function shortDescription(raw: string): string {
  let d = raw.replace(/[<>]/g, '').trim();
  if (!/#shorts\b/i.test(d)) d = d ? `${d}\n\n#Shorts` : '#Shorts';
  return d.slice(0, 5000);
}

/** The JSON body YouTube's videos.insert expects (snippet + status). */
export function buildVideoResource(m: ShortMeta) {
  const tags = [...new Set(['shorts', ...(m.tags ?? []).map((t) => clean(t).replace(/^#/, '')).filter(Boolean)])];
  // YouTube caps the combined tag length at 500 characters.
  const capped: string[] = [];
  let len = 0;
  for (const t of tags) {
    if (len + t.length + 1 > 500) break;
    capped.push(t);
    len += t.length + 1;
  }
  const status: Record<string, unknown> = {
    // A scheduled video must be private until YouTube publishes it at publishAt.
    privacyStatus: m.publishAt ? 'private' : m.privacy,
    selfDeclaredMadeForKids: !!m.madeForKids,
  };
  if (m.publishAt) status.publishAt = new Date(m.publishAt).toISOString();
  return {
    snippet: { title: shortTitle(m.title), description: shortDescription(m.description), tags: capped, categoryId: '22' },
    status,
  };
}

/**
 * Publish times for `count` videos: all null for "post now", otherwise the first at
 * `firstAt` and then one every `everyHours`.
 */
export function planSchedule(count: number, mode: 'now' | 'spread', firstAt: number, everyHours: number): (number | null)[] {
  if (mode === 'now') return Array.from({ length: count }, () => null);
  const step = Math.max(0.25, everyHours) * 3600_000;
  return Array.from({ length: count }, (_, i) => firstAt + i * step);
}

/** A reason the schedule can't be used, or null. YouTube needs publish times in the future. */
export function scheduleProblem(times: (number | null)[], now = Date.now()): string | null {
  const first = times.find((t) => t !== null);
  if (first == null) return null;
  if (!Number.isFinite(first)) return 'Pick a start date and time.';
  if (first < now + 10 * 60_000) return 'The first post must be at least 10 minutes from now.';
  return null;
}

/**
 * YouTube treats vertical or square videos up to 3 minutes as Shorts. Returns why a clip
 * would be posted as a regular video instead, or null if it qualifies.
 */
export function notShortReason(width: number, height: number, seconds: number): string | null {
  if (width > height) return 'It is wider than it is tall, so YouTube will post it as a regular video. Use 9:16 or 1:1.';
  if (seconds > 180) return 'It is longer than 3 minutes, so YouTube will post it as a regular video.';
  return null;
}
