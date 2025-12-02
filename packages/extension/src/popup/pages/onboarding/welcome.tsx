import { useNavigate } from 'react-router-dom'
import { Moon, Plus, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function WelcomePage() {
  const navigate = useNavigate()

  return (
    <div className="flex flex-col h-full">
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-8 shadow-lg">
          <Moon className="w-12 h-12 text-white" />
        </div>

        <h1 className="text-2xl font-bold mb-2 text-center">
          Welcome to Midnight Wallet
        </h1>
        <p className="text-slate-500 text-center mb-8 max-w-[280px]">
          Your gateway to privacy-preserving blockchain transactions
        </p>

        <div className="w-full space-y-3">
          <Button
            onClick={() => navigate('/create-wallet')}
            className="w-full"
            size="lg"
          >
            <Plus className="w-5 h-5 mr-2" />
            Create New Wallet
          </Button>

          <Button
            onClick={() => navigate('/import-wallet')}
            variant="outline"
            className="w-full"
            size="lg"
          >
            <Download className="w-5 h-5 mr-2" />
            Import Existing Wallet
          </Button>
        </div>
      </main>

      <div className="p-4 text-center">
        <p className="text-xs text-slate-400">
          By continuing, you agree to our Terms of Service
        </p>
      </div>
    </div>
  )
}
