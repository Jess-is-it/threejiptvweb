import { NextResponse } from 'next/server';
import { parseStreamBase, xtreamWithFallback } from '../../_shared';
export const dynamic = 'force-dynamic';

async function handle(req) {
  try {
    const url = new URL(req.url);
    const streamBase = url.searchParams.get('streamBase') || '';
    if (!streamBase) {
      return NextResponse.json({ ok: false, error: 'Missing streamBase' }, { status: 400 });
    }
    const { server, username, password } = parseStreamBase(streamBase);
    const raw = await xtreamWithFallback({ server, username, password, action: 'get_series_categories' });
    const categories = (Array.isArray(raw) ? raw : []).map((c) => ({
      id: String(c?.category_id ?? c?.id ?? ''),
      name: c?.category_name || c?.name || 'Unknown',
    }));
    return NextResponse.json({ ok: true, categories }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || 'Series categories error' }, { status: 502 });
  }
}
export async function GET(req) { return handle(req); }
export async function POST(req) { return handle(req); }
