'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Search, Sun, Moon, Monitor } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/components/providers/ThemeProvider'
import { cn } from '@/lib/utils'

const ENV_COLORS: Record<string, string> = {
  dev:     'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  staging: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  prod:    'bg-red-500/20 text-red-400 border-red-500/30',
}

export function Header() {
  const router = useRouter()
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [query, setQuery] = useState('')
  const env = process.env.NEXT_PUBLIC_ENVIRONMENT ?? 'dev'
  const envColor = ENV_COLORS[env] ?? ENV_COLORS.dev

  function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (q) {
      router.push(`/search?q=${encodeURIComponent(q)}`)
      setQuery('')
    }
  }

  function cycleTheme() {
    const next = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    setTheme(next)
  }

  const ThemeIcon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor

  return (
    <header className="h-14 flex items-center gap-4 px-4 border-b border-[var(--border)] bg-[var(--card)] shrink-0">
      {/* Search */}
      <form onSubmit={handleSearch} className="flex items-center gap-2 flex-1 max-w-sm">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--muted-foreground)]" />
          <Input
            placeholder="Search account ID..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
      </form>

      <div className="flex items-center gap-2 ml-auto">
        {/* Environment badge */}
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded border uppercase tracking-wide', envColor)}>
          {env}
        </span>

        {/* Theme toggle */}
        <Button variant="ghost" size="icon" onClick={cycleTheme} aria-label="Toggle theme">
          <ThemeIcon className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
