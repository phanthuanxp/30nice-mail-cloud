import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (host.startsWith('mail.') && request.nextUrl.pathname === '/') {
    return NextResponse.rewrite(new URL('/webmail', request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ['/'] };

