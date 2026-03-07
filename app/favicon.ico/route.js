import { NextResponse } from 'next/server';

export function GET(req) {
  return NextResponse.redirect(new URL('/favicon.svg', req.url), 307);
}

