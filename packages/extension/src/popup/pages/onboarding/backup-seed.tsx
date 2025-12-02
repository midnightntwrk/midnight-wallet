import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SeedPhraseDisplay } from '@/components/wallet/seed-phrase-display'
import { useEffect } from 'react'

export function BackupSeedPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { mnemonic, isNewWallet } = (location.state as {
    mnemonic: string[]
    isNewWallet: boolean
  }) || { mnemonic: [], isNewWallet: true }

  useEffect(() => {
    if (!mnemonic || mnemonic.length === 0) {
      navigate('/welcome', { replace: true })
    }
  }, [mnemonic, navigate])

  const handleContinue = () => {
    navigate('/confirm-seed', { state: { mnemonic, isNewWallet } })
  }

  if (!mnemonic || mnemonic.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-4 py-3 border-b border-slate-100">
        <button
          onClick={() => navigate('/create-wallet')}
          className="p-2 -ml-2 hover:bg-slate-100 rounded-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold text-center mr-7">
          Backup Recovery Phrase
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <span className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-semibold">
              2
            </span>
            <span className="text-sm font-medium text-indigo-600">of 3</span>
          </div>
          <h2 className="text-center text-lg font-semibold mb-1">
            Write Down Your Recovery Phrase
          </h2>
          <p className="text-center text-sm text-slate-500">
            This is the only way to recover your wallet
          </p>
        </div>

        <SeedPhraseDisplay
          words={mnemonic}
          showCopyButton={true}
        />
      </main>

      <div className="p-4 border-t border-slate-100">
        <Button onClick={handleContinue} className="w-full" size="lg">
          I&apos;ve Written It Down
        </Button>
      </div>
    </div>
  )
}
