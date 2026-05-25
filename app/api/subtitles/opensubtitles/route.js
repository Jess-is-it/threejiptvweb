import { NextResponse } from 'next/server';

import { getSubtitleFileAsVtt } from '../../../../lib/server/subtitles/openSubtitlesService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const fileId = searchParams.get('fileId') || '';
  const label = String(searchParams.get('label') || 'Subtitle').trim() || 'Subtitle';
  const lang = String(searchParams.get('lang') || '').trim();
  const mediaType = String(searchParams.get('mediaType') || '').trim();
  const title = String(searchParams.get('title') || '').trim();
  const year = String(searchParams.get('year') || '').trim();
  const seasonNumber = Number(searchParams.get('seasonNumber') || 0);
  const episodeNumber = Number(searchParams.get('episodeNumber') || 0);
  const numericFileId = Number(fileId || 0);

  if (!Number.isFinite(numericFileId) || numericFileId <= 0) {
    return NextResponse.json({ ok: false, error: 'Missing or invalid subtitle file id.' }, { status: 400 });
  }

  try {
    const body = await getSubtitleFileAsVtt({
      fileId: numericFileId,
      cacheTarget: title
        ? {
            mediaType,
            title,
            year,
            seasonNumber,
            episodeNumber,
            lang,
          }
        : null,
    });
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
        error: error?.message || 'OpenSubtitles subtitle fetch failed.',
      },
      { status: 502 }
    );
  }
}
