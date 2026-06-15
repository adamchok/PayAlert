import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export default function proxy(request: NextRequest) {
  const isAuthenticated =
    request.cookies.has('__Secure-authjs.session-token') ||
    request.cookies.has('authjs.session-token')

  if (isAuthenticated) return NextResponse.next()

  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const callbackPath =
    request.nextUrl.pathname === '/' ? '/dashboard' : request.nextUrl.pathname
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = ''
  loginUrl.searchParams.set('callbackUrl', callbackPath)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!login|api/auth|api/health|_next/static|_next/image|favicon\\.ico).*)'],
}
