import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border',
  {
    variants: {
      variant: {
        default:   'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
        secondary: 'bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]',
        outline:   'border-[var(--border)] text-[var(--foreground)] bg-transparent',
        critical:  'bg-red-950 text-red-100 border-red-800',
        high:      'bg-red-600 text-white border-red-700',
        medium:    'bg-amber-400 text-amber-950 border-amber-500',
        low:       'bg-green-600 text-white border-green-700',
        flagged:   'bg-orange-500 text-white border-orange-600',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
