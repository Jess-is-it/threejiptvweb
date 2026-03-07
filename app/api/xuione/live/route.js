import { NextResponse } from 'next/server';
import { parseStreamBase, xtreamWithFallback } from '../_shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function readStreamBase(req) {
  const url = new URL(req.url);
  const fromQuery = url.searchParams.get('streamBase');
  if (fromQuery) return String(fromQuery || '');

  // Allow POST body: { streamBase }
  if (req.method === 'POST') {
    const ct = req.headers.get('content-type') || '';
    try {
      if (ct.includes('application/json')) {
        const b = await req.json().catch(() => ({}));
        return String(b?.streamBase || '');
      }
      const raw = await req.text().catch(() => '');
      try {
        const b = JSON.parse(raw || '{}');
        return String(b?.streamBase || '');
      } catch {
        const p = new URLSearchParams(raw || '');
        return String(p.get('streamBase') || '');
      }
    } catch {
      return '';
    }
  }

  return '';
}

async function handle(req) {
  const streamBase = await readStreamBase(req);
  if (!streamBase) {
    return NextResponse.json({ ok: false, error: 'Missing streamBase' }, { status: 400 });
  }

  try {
    const { server, username, password } = parseStreamBase(streamBase);

    const [catsRaw, liveRaw] = await Promise.all([
      xtreamWithFallback({ server, username, password, action: 'get_live_categories' }).catch(() => []),
      xtreamWithFallback({ server, username, password, action: 'get_live_streams' }),
    ]);

    const categories = (Array.isArray(catsRaw) ? catsRaw : []).map((c) => ({
      id: String(c?.category_id ?? c?.id ?? ''),
      name: c?.category_name || c?.name || 'Unknown',
    }));

    const channels = (Array.isArray(liveRaw) ? liveRaw : []).map((ch) => {
      const id = ch?.stream_id ?? ch?.id;
      return {
        id,
        name: ch?.name || `CH ${id}`,
        logo: ch?.stream_icon || ch?.logo || '',
        number: ch?.num ?? ch?.number ?? null,
        category_id: ch?.category_id ?? ch?.categoryId ?? '',
      };
    });

    return NextResponse.json({ ok: true, categories, channels }, { status: 200 });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e?.message || 'Failed to load live channels' },
      { status: 502 }
    );
  }
}

export async function GET(req) {
  return handle(req);
}

export async function POST(req) {
  return handle(req);
}
