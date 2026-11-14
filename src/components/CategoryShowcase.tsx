import Link from 'next/link';
import type { CategoryTile } from '@/lib/db';

// Editorial grid: tiles go in pairs whose widths alternate 3:2 then 2:3, with
// the label and a "Shop Now" link in the top-left corner of each photo.
export default function CategoryShowcase({ tiles }: { tiles: CategoryTile[] }) {
  const features = tiles.filter((t) => t.kind === 'feature').slice(0, 2);
  const products = tiles.filter((t) => t.kind === 'product').slice(0, 4);
  const ordered = [...features, ...products];
  if (ordered.length === 0) return null;

  const rows: CategoryTile[][] = [];
  for (let i = 0; i < ordered.length; i += 2) rows.push(ordered.slice(i, i + 2));

  return (
    <section className="w-full px-3 md:px-4 py-10 md:py-14">
      <div className="space-y-3 md:space-y-4">
        {rows.map((row, rowIndex) => {
          const wideFirst = rowIndex % 2 === 0;
          const columns = row.length === 1 ? 'md:grid-cols-1' : wideFirst ? 'md:grid-cols-[3fr_2fr]' : 'md:grid-cols-[2fr_3fr]';
          return (
            <div key={rowIndex} className={`grid grid-cols-1 ${columns} gap-3 md:gap-4`}>
              {row.map((t) => (
                <CategoryCard key={t.id} tile={t} />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function CategoryCard({ tile }: { tile: CategoryTile }) {
  const title = tile.sublabel ? `${tile.label} | ${tile.sublabel}` : tile.label;
  return (
    <Link
      href={tile.link || '/shop'}
      className="group relative block h-[62vw] max-h-[520px] md:h-[clamp(320px,34vw,520px)] overflow-hidden"
      style={{ backgroundColor: tile.bgColor }}
    >
      <img
        src={tile.image}
        alt={tile.label}
        loading="lazy"
        decoding="async"
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105"
      />
      {/* Keeps the white text readable on light photos. */}
      <div className="absolute inset-0 bg-gradient-to-br from-black/45 via-black/5 to-transparent" />
      <div className="absolute left-5 top-5 md:left-6 md:top-6 pr-6 text-white">
        {title && (
          <div className="text-lg md:text-2xl font-medium tracking-wide drop-shadow-[0_1px_8px_rgba(0,0,0,0.35)]">
            {title}
          </div>
        )}
        <span className="mt-1.5 inline-block border-b border-white pb-0.5 text-sm md:text-base font-medium drop-shadow-[0_1px_6px_rgba(0,0,0,0.35)] transition-[letter-spacing] duration-300 group-hover:tracking-wide">
          Shop Now
        </span>
      </div>
    </Link>
  );
}
