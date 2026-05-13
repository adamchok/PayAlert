import { User, CreditCard, Star, Hash } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { Transaction } from '@/lib/types'

interface CustomerInfoStripProps {
  accountId: string
  item?: Transaction
  total: number
  flagged: number
}

function InfoChip({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
      <div>
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] font-semibold">{label}</p>
        <p className="text-sm font-medium text-[var(--foreground)]">{value}</p>
      </div>
    </div>
  )
}

export function CustomerInfoStrip({ accountId, item, total, flagged }: CustomerInfoStripProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)] font-semibold">Account</p>
            <p className="font-mono text-sm font-bold text-[var(--foreground)]">{accountId}</p>
          </div>

          {item?.customerName && (
            <InfoChip icon={User} label="Customer" value={item.customerName} />
          )}
          {item?.customerTier && (
            <InfoChip icon={Star} label="Tier" value={item.customerTier} />
          )}
          {item?.cardType && item?.cardLast4 && (
            <InfoChip icon={CreditCard} label="Card" value={`${item.cardType} ····${item.cardLast4}`} />
          )}
          {item?.customerId && (
            <InfoChip icon={Hash} label="Customer ID" value={item.customerId} />
          )}

          <div className="ml-auto flex items-center gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold text-[var(--foreground)]">{total}</p>
              <p className="text-xs text-[var(--muted-foreground)]">Total</p>
            </div>
            <div className="text-center">
              <p className={`text-2xl font-bold ${flagged > 0 ? 'text-orange-400' : 'text-[var(--foreground)]'}`}>{flagged}</p>
              <p className="text-xs text-[var(--muted-foreground)]">Flagged</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
