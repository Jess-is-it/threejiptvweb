const MOVIE_PLAY_SEED_KEY = '3jtv.moviePlaySeed';
const MOVIE_RETURN_STATE_KEY = '3jtv.movieReturnState';
const MOVIE_PLAY_SEED_TTL_MS = 10 * 60 * 1000;

function asText(value = '') {
  const next = String(value || '').trim();
  return next || '';
}

function asNullableText(value = '') {
  const next = asText(value);
  return next || null;
}

export function buildMoviePlaySeed(item, extra = {}) {
  const id = asText(extra?.id || item?.id);
  if (!id) return null;

  const backHref = asText(extra?.backHref || item?.backHref || `/movies/${id}`) || '/movies';

  return {
    id,
    title: asText(extra?.title || item?.title) || `Movie #${id}`,
    image: asText(extra?.image || item?.image),
    plot: asText(extra?.plot || item?.plot || item?.overview),
    year: extra?.year ?? item?.year ?? null,
    genre: asNullableText(extra?.genre || item?.genre),
    duration: extra?.duration ?? item?.duration ?? null,
    rating: extra?.rating ?? item?.rating ?? null,
    ext: asNullableText(extra?.ext || item?.ext),
    backHref,
    storedAt: Date.now(),
  };
}

export function persistMoviePlaySeed(item, extra = {}) {
  if (typeof window === 'undefined') return null;
  const seed = buildMoviePlaySeed(item, extra);
  if (!seed) return null;
  try {
    sessionStorage.setItem(MOVIE_PLAY_SEED_KEY, JSON.stringify(seed));
  } catch {}
  return seed;
}

export function readMoviePlaySeed(id = '') {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(MOVIE_PLAY_SEED_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const seedId = asText(parsed?.id);
    if (!seedId) return null;
    if (asText(id) && seedId !== asText(id)) return null;

    const storedAt = Number(parsed?.storedAt || 0);
    if (storedAt > 0 && Date.now() - storedAt > MOVIE_PLAY_SEED_TTL_MS) return null;

    return {
      ...parsed,
      id: seedId,
      title: asText(parsed?.title) || `Movie #${seedId}`,
      image: asText(parsed?.image),
      plot: asText(parsed?.plot),
      genre: asNullableText(parsed?.genre),
      ext: asNullableText(parsed?.ext),
      backHref: asText(parsed?.backHref || `/movies/${seedId}`) || '/movies',
    };
  } catch {
    return null;
  }
}

export function persistMovieReturnState(state = {}) {
  if (typeof window === 'undefined') return null;
  const href = asText(state?.href);
  if (!href) return null;

  const next = {
    href,
    source: asText(state?.source),
    movieId: asText(state?.movieId),
    scrollY: Math.max(0, Number(state?.scrollY || 0) || 0),
    visibleCount: Math.max(0, Number(state?.visibleCount || 0) || 0),
    allMoviesIndex: Math.max(0, Number(state?.allMoviesIndex || 0) || 0),
    storedAt: Date.now(),
  };

  try {
    sessionStorage.setItem(MOVIE_RETURN_STATE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function readMovieReturnState() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(MOVIE_RETURN_STATE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    const href = asText(parsed?.href);
    if (!href) return null;

    const storedAt = Number(parsed?.storedAt || 0);
    if (storedAt > 0 && Date.now() - storedAt > MOVIE_PLAY_SEED_TTL_MS) return null;

    return {
      href,
      source: asText(parsed?.source),
      movieId: asText(parsed?.movieId),
      scrollY: Math.max(0, Number(parsed?.scrollY || 0) || 0),
      visibleCount: Math.max(0, Number(parsed?.visibleCount || 0) || 0),
      allMoviesIndex: Math.max(0, Number(parsed?.allMoviesIndex || 0) || 0),
      storedAt,
    };
  } catch {
    return null;
  }
}

export function clearMovieReturnState() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(MOVIE_RETURN_STATE_KEY);
  } catch {}
}
