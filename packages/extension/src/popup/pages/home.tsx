import { useNavigate } from 'react-router-dom'
import { ArrowUp, ArrowDown, ArrowLeftRight, TrendingUp, TrendingDown } from 'lucide-react'
import { useWalletStore } from '@/store/wallet-store'

const mockTokens = [
  { symbol: 'NIGHT', name: 'Midnight', amount: '125.50', value: '$8,785.00', change: '+3.2%', positive: true },
  { symbol: 'DUST', name: 'Dust Token', amount: '3,560.67', value: '$3,560.67', change: '-0.8%', positive: false },
]

const mockActivity = [
  { type: 'sent', address: 'midnight1x7...k3f', amount: '25.00', token: 'NIGHT', date: 'Dec 3, 2025 14:30' },
  { type: 'received', address: 'midnight1a9...m2p', amount: '100.00', token: 'NIGHT', date: 'Dec 2, 2025 09:15' },
]

export function HomePage() {
  const navigate = useNavigate()
  const { balance } = useWalletStore()

  return (
    <div className="px-4 py-4">
      <div className="bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-5 text-white mb-4">
        <p className="text-sm text-white/70 mb-1">Total Balance</p>
        <h1 className="text-3xl font-bold mb-1">$12,345.67</h1>
        <p className="text-sm text-green-300 flex items-center gap-1">
          <TrendingUp className="w-4 h-4" />
          +2.34% today
        </p>

        <div className="flex justify-center gap-6 mt-5">
          <button
            onClick={() => navigate('/send')}
            className="flex flex-col items-center gap-1"
          >
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <ArrowUp className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium">Send</span>
          </button>

          <button
            onClick={() => navigate('/receive')}
            className="flex flex-col items-center gap-1"
          >
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <ArrowDown className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium">Receive</span>
          </button>

          <button className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <span className="text-xs font-medium">Swap</span>
          </button>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Tokens</h2>
          <button className="text-sm text-indigo-600 font-medium">See all</button>
        </div>

        <div className="space-y-2">
          {mockTokens.map((token) => (
            <div
              key={token.symbol}
              className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
            >
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${
                  token.symbol === 'NIGHT'
                    ? 'bg-purple-100 text-purple-600'
                    : 'bg-amber-100 text-amber-600'
                }`}>
                  {token.symbol[0]}
                </div>
                <div>
                  <p className="font-medium">{token.symbol}</p>
                  <p className="text-xs text-slate-500">{token.amount} {token.symbol}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium">{token.value}</p>
                <p className={`text-xs ${token.positive ? 'text-green-500' : 'text-red-500'}`}>
                  {token.change}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent Activity</h2>
          <button className="text-sm text-indigo-600 font-medium">See all</button>
        </div>

        <div className="space-y-2">
          {mockActivity.map((activity, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
            >
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  activity.type === 'sent'
                    ? 'bg-red-100'
                    : 'bg-green-100'
                }`}>
                  {activity.type === 'sent' ? (
                    <ArrowUp className="w-4 h-4 text-red-500" />
                  ) : (
                    <ArrowDown className="w-4 h-4 text-green-500" />
                  )}
                </div>
                <div>
                  <p className="font-medium text-sm">
                    {activity.type === 'sent' ? 'Sent to' : 'Received from'} {activity.address}
                  </p>
                  <p className="text-xs text-slate-500">{activity.date}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`font-medium text-sm ${
                  activity.type === 'sent' ? 'text-red-500' : 'text-green-500'
                }`}>
                  {activity.type === 'sent' ? '-' : '+'}{activity.amount}
                </p>
                <p className="text-xs text-slate-500">{activity.token}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
