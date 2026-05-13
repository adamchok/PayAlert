import { Badge } from '@/components/ui/badge'
import type { RiskLevel } from '@/lib/types'

interface RiskBadgeProps {
  level: RiskLevel
  score?: number
  size?: 'sm' | 'md' | 'lg'
}

const variantMap: Record<RiskLevel, 'critical' | 'high' | 'medium' | 'low'> = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
}

export function RiskBadge({ level, score, size = 'md' }: RiskBadgeProps) {
  const sizeClass = size === 'lg' ? 'text-sm px-3 py-1' : size === 'sm' ? 'text-[10px] px-2 py-0.5' : ''
  return (
    <Badge variant={variantMap[level] ?? 'secondary'} className={sizeClass}>
      {level}{score !== undefined ? ` · ${score}` : ''}
    </Badge>
  )
}
