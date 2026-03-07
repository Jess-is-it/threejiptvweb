'use client';
import Link from 'next/link';

export default function MediaCard({ item, kind = 'movie' }) {
  const tmdb = (p, size) => (p ? `https://image.tmdb.org/t/p/${size}${p}` : null);
  const img =
    item.image ||
    tmdb(item.poster_path, 'w342') ||
    tmdb(item.backdrop_path, 'w342') ||
    '';
  const title =
    item.title ||
    item.name ||
    item.original_title ||
    item.original_name ||
    'Untitled';

  return (
    <Link href={item.href || '#'} className="group block">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-neutral-800">
        {img ? (
          <img
            src={img}
            alt={title}
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          />
        ) : null}
      </div>
      <div className="mt-2 line-clamp-2 text-sm text-neutral-200">{title}</div>
    </Link>
  );
}
