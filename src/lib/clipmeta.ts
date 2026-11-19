// Free, offline titles, descriptions and hashtags for a clip, written from its transcript.
// No AI service: the title is the clip's most hook-like opening sentence, the hashtags are
// its most-used meaningful words. Pure functions, no I/O.

const STOP = new Set(`a about above after again against all also am an and any are aren't as at be because been
before being below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down
during each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers
herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most
mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she
she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves then there
there's these they they'd they'll they're they've this those through to too under until up very was wasn't we we'd
we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's with won't
would wouldn't you you'd you'll you're you've your yours yourself yourselves
um uh uhm erm hmm yeah yes yep okay ok oh like just really actually basically literally gonna wanna gotta kind sort
thing things stuff know mean think thought guess get got getting go going goes went come came want wanted need right
well also said say says saying tell told one two lot lots way something anything everything nothing someone anyone
everyone somebody anybody people person time times today now then still even ever never always maybe much many make
made making take took look looks see seen let lets put back good great little big new old first last next sure
really pretty quite whole else every another able since though although yet already enough`.split(/\s+/));

// "you know" / "i mean" only count as filler with a comma ("You know what?" is a hook).
const FILLER_LEAD = /^(?:(?:so|um+|uh+|and|but|like|okay|ok|well|yeah|right|anyway|alright|now)[,.!]?\s+|(?:you know|i mean),\s+)+/i;
const HOOK = /\b(how|why|what|secret|never|always|mistake|truth|best|worst|stop|need|must|biggest|first|most|only|nobody|everyone|crazy|insane|money|free|hack|tip|easy|fast|you)\b/i;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Splits text into sentences on . ? ! (keeping the mark). */
export function sentences(text: string): string[] {
  return (text.replace(/\s+/g, ' ').match(/[^.?!…]+[.?!…]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Removes spoken filler from the start of a sentence ("So um, and" …). */
export function trimFiller(s: string): string {
  return s.replace(FILLER_LEAD, '').trim();
}

/**
 * A title from the clip's words: the most hook-like of its first three sentences (a
 * question or a strong statement), without leading filler, at most `max` characters.
 */
export function clipTitle(text: string, max = 90): string {
  const cands = sentences(text).slice(0, 3).map((raw, i) => {
    const s = trimFiller(raw);
    let score = 0;
    if (/\?$/.test(s)) score += 3;
    if (HOOK.test(s)) score += 2;
    if (s.length >= 20 && s.length <= max) score += 1;
    if (s.length < 12) score -= 2;
    if (raw !== s) score -= 0.5;
    score -= i * 0.5; // prefer earlier: it is what viewers hear first
    return { s, score };
  }).filter((c) => c.s);
  if (!cands.length) return '';
  let best = cands.reduce((a, b) => (b.score > a.score ? b : a)).s;
  if (best.length > max) best = `${best.slice(0, max - 1).replace(/\s+\S*$/, '').replace(/[,;:]$/, '')}…`;
  return capital(best);
}

/** Meaningful words of a text (lowercase, no stop words, filler or numbers). */
function contentWords(text: string): string[] {
  const words = text.toLowerCase().replace(/[’']/g, "'").match(/[\p{L}\p{N}][\p{L}\p{N}']*/gu) ?? [];
  return words
    .filter((w) => !STOP.has(w))
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w) && !w.includes("'"));
}

/**
 * The clip's key words, best first (for hashtags and tags): words said at least twice,
 * topped up with long, specific words (7+ letters) when there are fewer than three.
 */
export function keywords(text: string, n = 5): string[] {
  const count = new Map<string, { n: number; first: number }>();
  contentWords(text).forEach((word, i) => {
    const c = count.get(word);
    if (c) c.n += 1;
    else count.set(word, { n: 1, first: i });
  });
  // Fold simple plurals into the singular when both appear ("habit" + "habits").
  for (const [w, c] of count) {
    const single = w.endsWith('s') ? w.slice(0, -1) : '';
    const s = single && count.get(single);
    if (s) { s.n += c.n; s.first = Math.min(s.first, c.first); count.delete(w); }
  }
  const ranked = [...count.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[0].length - a[0].length || a[1].first - b[1].first);
  const strong = ranked.filter(([, c]) => c.n >= 2).map(([w]) => w);
  const extra = ranked.filter(([w, c]) => c.n < 2 && w.length >= 7).map(([w]) => w);
  return [...strong, ...extra.slice(0, Math.max(0, 3 - strong.length))].slice(0, n);
}

/** "#money #saving" from keywords; YouTube shows the first three hashtags above the title. */
export function hashtags(words: string[]): string {
  return ['shorts', ...words.filter((w) => w !== 'shorts')].map((w) => `#${w.replace(/'/g, '')}`).join(' ');
}

/**
 * A description: the clip's opening line or two (as a teaser), the shop's own line, then
 * hashtags. Kept short, since only the first lines show on a Short.
 */
export function clipDescription(text: string, footer = '', words = keywords(text)): string {
  const teaser: string[] = [];
  // Skip empty openers like "Let me tell you something." (fewer than two meaningful words).
  for (const s of sentences(text).map(trimFiller).filter((s) => contentWords(s).length >= 2)) {
    if (teaser.join(' ').length + s.length > 220) break;
    teaser.push(capital(s));
    if (teaser.length === 2) break;
  }
  return [teaser.join(' '), footer.trim(), hashtags(words)].filter(Boolean).join('\n\n');
}
