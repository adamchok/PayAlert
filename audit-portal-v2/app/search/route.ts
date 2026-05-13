import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'

export function GET(request: NextRequest): never {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q) {
    redirect(`/account/${encodeURIComponent(q)}`)
  }
  redirect('/dashboard')
}
