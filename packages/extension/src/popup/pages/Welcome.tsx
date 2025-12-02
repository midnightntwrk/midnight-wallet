import { Button } from '@/components/ui/button'
import { Moon } from 'lucide-react'

export function WelcomePage() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6">
        <Moon className="w-10 h-10 text-white" />
      </div>

      <h1 className="text-2xl font-bold text-slate-900 mb-2">
        Midnight Wallet
      </h1>

      <p className="text-slate-500 text-sm mb-8 max-w-[280px]">
        Privacy-first wallet for the Midnight Network with zero-knowledge proof technology
      </p>

      <div className="w-full space-y-3">
        <Button className="w-full" size="lg">
          Create New Wallet
        </Button>

        <Button variant="outline" className="w-full" size="lg">
          Import Existing Wallet
        </Button>
      </div>

      <p className="text-xs text-slate-400 mt-auto pt-8">
        By continuing, you agree to our Terms of Service
      </p>
    </div>
  )
}
