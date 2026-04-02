import { NextResponse } from 'next/server';

import { getLocalSubtitleAsVtt } from '../../../../lib/server/subtitles/localSubtitleService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const encodedPath = searchParams.get('path') || '';
  const ext = searchParams.get('ext') || '';
  const label = String(searchParams.get('label') || 'Subtitle').trim() || 'Subtitle';

  if (!encodedPath) {
    return NextResponse.json({ ok: false, error: 'Missing local subtitle path.' }, { status: 400 });
  }

  try {
    const body = await getLocalSubtitleAsVtt({ encodedPath, ext });
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/vtt; charset=utf-8',
        'Content-Disposition': `inline; filename="${label.replace(/[^a-z0-9._ -]/gi, '_')}.vtt"`,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || 'Local subtitle fetch failed.',
      },
      { status: 502 }
    );
  }
}
