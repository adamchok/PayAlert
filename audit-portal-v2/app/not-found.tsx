import Link from 'next/link'
import { Shield } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--background)] gap-4">
      <Shield className="h-12 w-12 text-blue-400" />
      <h1 className="text-2xl font-bold text-[var(--foreground)]">404 — Not Found</h1>
      <p className="text-[var(--muted-foreground)]">The resource you're looking for doesn't exist.</p>
      <Link
        href="/dashboard"
        className="inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium h-9 px-4 bg-blue-600 text-white hover:bg-blue-700 transition-colors"
      >
        Back to Dashboard
      </Link>
    </div>
  )
}
