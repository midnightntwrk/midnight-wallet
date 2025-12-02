import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { generateMnemonic } from '@/lib/background'

export function CreateWalletPage() {
  const navigate = useNavigate()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreateWallet = async () => {
    setIsLoading(true)
    setError('')

    try {
      const mnemonic = await generateMnemonic()
      navigate('/backup-seed', { state: { mnemonic, isNewWallet: true } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate wallet')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-4 py-3 border-b border-slate-100">
        <button
          onClick={() => navigate('/welcome')}
          className="p-2 -ml-2 hover:bg-slate-100 rounded-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold text-center mr-7">
          Create Wallet
        </h1>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center mb-6">
          <span className="text-4xl">🔐</span>
        </div>

        <h2 className="text-xl font-semibold mb-2 text-center">
          Create a New Wallet
        </h2>
        <p className="text-slate-500 text-center mb-8 max-w-[280px]">
          We&apos;ll generate a unique 24-word recovery phrase that secures your wallet
        </p>

        <div className="w-full space-y-4 bg-slate-50 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-medium">
              1
            </span>
            <div>
              <p className="text-sm font-medium">Generate recovery phrase</p>
              <p className="text-xs text-slate-500">24 words that secure your wallet</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-sm font-medium">
              2
            </span>
            <div>
              <p className="text-sm font-medium text-slate-600">Write it down</p>
              <p className="text-xs text-slate-400">Store it safely offline</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-sm font-medium">
              3
            </span>
            <div>
              <p className="text-sm font-medium text-slate-600">Set password</p>
              <p className="text-xs text-slate-400">Protect your wallet</p>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-red-500 text-sm mb-4 text-center">{error}</p>
        )}
      </main>

      <div className="p-4">
        <Button
          onClick={handleCreateWallet}
          disabled={isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Generating...
            </>
          ) : (
            'Generate Recovery Phrase'
          )}
        </Button>
      </div>
    </div>
  )
}
