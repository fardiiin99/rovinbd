import Link from 'next/link';

export type LookItem = { id: string; image: string; link: string; label: string };

// "Shop the look": a row of square photos, each with a round bag button in the
// corner that opens the linked product. Managed in Admin → Gallery.
export default function LookGallery({ items }: { items: LookItem[] }) {
  const looks = items.filter((l) => l.image).slice(0, 4);
  if (looks.length === 0) return null;

  return (
    <section className="w-full bg-white p-1 md:p-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-1 md:gap-4">
        {looks.map((look) => (
          <Link
            key={look.id}
            href={look.link || '/shop'}
            aria-label={look.label ? `Shop ${look.label}` : 'Shop this look'}
            className="group relative block aspect-square overflow-hidden bg-stone-100"
          >
            <img
              src={look.image}
              alt={look.label}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-105"
            />
            <span className="absolute bottom-3 right-3 md:bottom-5 md:right-5 flex h-9 w-9 md:h-10 md:w-10 items-center justify-center rounded-full bg-white text-stone-900 shadow-md transition-transform duration-300 group-hover:scale-110">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M6 7h12l1 14H5L6 7z" strokeLinejoin="round" />
                <path d="M9 10V6a3 3 0 0 1 6 0v4" strokeLinecap="round" />
              </svg>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
