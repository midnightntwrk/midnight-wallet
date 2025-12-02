import { ArrowUp, ArrowDown, ArrowLeftRight, TrendingUp, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { Balance } from '@/store/wallet-store'
import { formatAmount } from '@/lib/format'

interface BalanceCardProps {
  balance: Balance | null
  isLoading?: boolean
}

export function BalanceCard({ balance, isLoading }: BalanceCardProps) {
  const navigate = useNavigate()

  const totalBalance = balance
    ? BigInt(balance.shielded) + BigInt(balance.unshielded) + BigInt(balance.dust)
    : BigInt(0)

  return (
    <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white mb-4">
      <p className="text-sm text-white/70 mb-1">Total Balance</p>

      {isLoading ? (
        <div className="flex items-center gap-2 mb-1">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-lg">Loading...</span>
        </div>
      ) : (
        <>
          <h1 className="text-3xl font-bold mb-1">
            {formatAmount(totalBalance.toString())} tDUST
          </h1>
          <p className="text-sm text-green-300 flex items-center gap-1">
            <TrendingUp className="w-4 h-4" />
            Testnet
          </p>
        </>
      )}

      {balance && !isLoading && (
        <div className="flex gap-4 mt-3 text-xs text-white/70">
          <div>
            <span>Shielded: </span>
            <span className="text-white">{formatAmount(balance.shielded)}</span>
          </div>
          <div>
            <span>Unshielded: </span>
            <span className="text-white">{formatAmount(balance.unshielded)}</span>
          </div>
          <div>
            <span>Dust: </span>
            <span className="text-white">{formatAmount(balance.dust)}</span>
          </div>
        </div>
      )}

      <div className="flex justify-center gap-6 mt-5">
        <button
          onClick={() => navigate('/send')}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
            <ArrowUp className="w-5 h-5" />
          </div>
          <span className="text-xs font-medium">Send</span>
        </button>

        <button
          onClick={() => navigate('/receive')}
          className="flex flex-col items-center gap-1"
        >
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors">
            <ArrowDown className="w-5 h-5" />
          </div>
          <span className="text-xs font-medium">Receive</span>
        </button>

        <button className="flex flex-col items-center gap-1 opacity-50 cursor-not-allowed">
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
          <span className="text-xs font-medium">Swap</span>
        </button>
      </div>
    </div>
  )
}
