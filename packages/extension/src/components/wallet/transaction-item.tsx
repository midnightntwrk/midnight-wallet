import { ArrowUp, ArrowDown, Clock } from 'lucide-react'
import type { Transaction } from '@/store/wallet-store'
import { formatAmount, truncateAddress, formatRelativeTime } from '@/lib/format'

interface TransactionItemProps {
  transaction: Transaction
}

export function TransactionItem({ transaction }: TransactionItemProps) {
  const isSent = transaction.type === 'sent'
  const isPending = transaction.status === 'pending'

  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer">
      <div className="flex items-center gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isPending
              ? 'bg-amber-100'
              : isSent
                ? 'bg-red-100'
                : 'bg-green-100'
          }`}
        >
          {isPending ? (
            <Clock className="w-4 h-4 text-amber-500" />
          ) : isSent ? (
            <ArrowUp className="w-4 h-4 text-red-500" />
          ) : (
            <ArrowDown className="w-4 h-4 text-green-500" />
          )}
        </div>
        <div>
          <p className="font-medium text-sm">
            {isSent ? 'Sent to' : 'Received from'}{' '}
            {truncateAddress(transaction.address)}
          </p>
          <p className="text-xs text-slate-500">
            {formatRelativeTime(transaction.timestamp)}
            {isPending && (
              <span className="ml-2 text-amber-500">• Pending</span>
            )}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p
          className={`font-medium text-sm ${
            isPending
              ? 'text-amber-500'
              : isSent
                ? 'text-red-500'
                : 'text-green-500'
          }`}
        >
          {isSent ? '-' : '+'}
          {formatAmount(transaction.amount)}
        </p>
        <p className="text-xs text-slate-500">tDUST</p>
      </div>
    </div>
  )
}
