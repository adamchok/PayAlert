import { auth } from '@/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  if (req.auth) return NextResponse.next()

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const callbackPath = req.nextUrl.pathname === '/' ? '/dashboard' : req.nextUrl.pathname
  const loginUrl = new URL('/login', req.url)
  loginUrl.searchParams.set('callbackUrl', callbackPath)
  return NextResponse.redirect(loginUrl)
})

export const config = {
  matcher: ['/((?!login|api/auth|api/health|_next/static|_next/image|favicon\\.ico).*)'],
}
