import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useWalletStore } from '@/store/wallet-store'
import { Home, Send, QrCode, Settings, Moon } from 'lucide-react'
import { cn } from '@/lib/utils'

function Header() {
  const { activeWallet } = useWalletStore()

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
          <Moon className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-sm">
          {activeWallet?.name || 'Midnight Wallet'}
        </span>
      </div>
    </header>
  )
}

function TabNav() {
  const navigate = useNavigate()
  const location = useLocation()

  const tabs = [
    { path: '/home', icon: Home, label: 'Home' },
    { path: '/send', icon: Send, label: 'Send' },
    { path: '/receive', icon: QrCode, label: 'Receive' },
    { path: '/settings', icon: Settings, label: 'Settings' },
  ]

  return (
    <nav className="flex items-center justify-around border-t border-slate-100 bg-white">
      {tabs.map(({ path, icon: Icon, label }) => (
        <button
          key={path}
          onClick={() => navigate(path)}
          className={cn(
            'flex flex-col items-center py-2 px-4 text-xs transition-colors',
            location.pathname === path
              ? 'text-indigo-600'
              : 'text-slate-400 hover:text-slate-600'
          )}
        >
          <Icon className="w-5 h-5 mb-1" />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  )
}

export function MainLayout() {
  const { isUnlocked } = useWalletStore()
  const location = useLocation()

  const showNav = isUnlocked && location.pathname !== '/unlock'

  return (
    <div className="w-[360px] h-[600px] bg-white flex flex-col overflow-hidden">
      <Header />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
      {showNav && <TabNav />}
    </div>
  )
}
