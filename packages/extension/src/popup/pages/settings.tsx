import { useNavigate } from 'react-router-dom'
import {
  Lock,
  Shield,
  Bell,
  Globe,
  HelpCircle,
  FileText,
  ChevronRight,
  Moon,
} from 'lucide-react'
import { useWalletStore } from '@/store/wallet-store'
import { lock } from '@/lib/background'

const settingsItems = [
  { icon: Shield, label: 'Security', description: 'Manage wallet security', path: '/settings/security' },
  { icon: Bell, label: 'Notifications', description: 'Configure alerts', path: '/settings/notifications' },
  { icon: Globe, label: 'Network', description: 'Select network', path: '/settings/network' },
  { icon: Moon, label: 'Appearance', description: 'Theme and display', path: '/settings/appearance' },
  { icon: HelpCircle, label: 'Help & Support', description: 'Get assistance', path: '/settings/help' },
  { icon: FileText, label: 'About', description: 'App version and info', path: '/settings/about' },
]

export function SettingsPage() {
  const navigate = useNavigate()
  const { activeWallet, lock: lockStore } = useWalletStore()

  async function handleLock() {
    try {
      await lock()
      lockStore()
      navigate('/unlock', { replace: true })
    } catch (err) {
      console.error('Failed to lock:', err)
    }
  }

  return (
    <div className="p-4">
      <div className="bg-slate-50 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold">
            {activeWallet?.name?.[0] || 'M'}
          </div>
          <div>
            <p className="font-semibold">{activeWallet?.name || 'Midnight Wallet'}</p>
            <p className="text-xs text-slate-500">midnight1qwer...6789</p>
          </div>
        </div>
      </div>

      <div className="space-y-1 mb-4">
        {settingsItems.map(({ icon: Icon, label, description }) => (
          <button
            key={label}
            className="w-full flex items-center justify-between p-3 hover:bg-slate-50 rounded-xl transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                <Icon className="w-5 h-5 text-slate-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">{label}</p>
                <p className="text-xs text-slate-500">{description}</p>
              </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-400" />
          </button>
        ))}
      </div>

      <button
        onClick={handleLock}
        className="w-full flex items-center justify-center gap-2 p-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors"
      >
        <Lock className="w-5 h-5" />
        <span className="font-medium">Lock Wallet</span>
      </button>

      <p className="text-center text-xs text-slate-400 mt-4">
        Version 0.1.0
      </p>
    </div>
  )
}
