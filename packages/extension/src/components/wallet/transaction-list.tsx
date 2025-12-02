import { Loader2 } from 'lucide-react'
import type { Transaction } from '@/store/wallet-store'
import { TransactionItem } from './transaction-item'

interface TransactionListProps {
  transactions: Transaction[]
  isLoading?: boolean
  limit?: number
  showSeeAll?: boolean
  onSeeAll?: () => void
}

export function TransactionList({
  transactions,
  isLoading,
  limit,
  showSeeAll,
  onSeeAll,
}: TransactionListProps) {
  const displayTransactions = limit ? transactions.slice(0, limit) : transactions

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-slate-400">
        <p className="text-sm">No transactions yet</p>
        <p className="text-xs mt-1">Your transaction history will appear here</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Recent Activity</h2>
        {showSeeAll && transactions.length > (limit || 0) && (
          <button
            onClick={onSeeAll}
            className="text-sm text-indigo-600 font-medium hover:text-indigo-700"
          >
            See all
          </button>
        )}
      </div>

      <div className="space-y-2">
        {displayTransactions.map((transaction) => (
          <TransactionItem key={transaction.hash} transaction={transaction} />
        ))}
      </div>
    </div>
  )
}
