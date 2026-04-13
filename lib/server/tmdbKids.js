import 'server-only';

export function pickUsMovieCertification(details) {
  const results = Array.isArray(details?.release_dates?.results) ? details.release_dates.results : [];
  const us = results.find((row) => String(row?.iso_3166_1 || '').toUpperCase() === 'US');
  const dates = Array.isArray(us?.release_dates) ? us.release_dates : [];
  const certification = dates
    .map((row) => String(row?.certification || '').trim())
    .find((value) => value);
  return certification || '';
}

export function pickUsTvContentRating(details) {
  const results = Array.isArray(details?.content_ratings?.results) ? details.content_ratings.results : [];
  const us = results.find((row) => String(row?.iso_3166_1 || '').toUpperCase() === 'US');
  return String(us?.rating || '').trim();
}

export function computeKidsSafe({ mediaType, certification, contentRating, genres }) {
  const list = Array.isArray(genres) ? genres : [];
  const normalizedGenres = new Set(list.map((genre) => String(genre || '').trim().toLowerCase()).filter(Boolean));
  const familySignal = normalizedGenres.has('family') || normalizedGenres.has('animation');
  const mt = String(mediaType || '').trim().toLowerCase() === 'tv' ? 'tv' : 'movie';

  if (mt === 'movie') {
    const cert = String(certification || '').trim().toUpperCase();
    if (cert) {
      const kidsSafe = cert === 'G' || cert === 'PG';
      return { kidsSafe, reason: `MPAA ${cert}` };
    }
    if (familySignal) return { kidsSafe: true, reason: 'Family/Animation' };
    return { kidsSafe: false, reason: 'Unrated' };
  }

  const rating = String(contentRating || '').trim().toUpperCase();
  if (rating) {
    const kidsSafe = rating === 'TV-Y' || rating === 'TV-Y7' || rating === 'TV-G';
    return { kidsSafe, reason: rating };
  }
  if (familySignal) return { kidsSafe: true, reason: 'Family/Animation' };
  return { kidsSafe: false, reason: 'Unrated' };
}
