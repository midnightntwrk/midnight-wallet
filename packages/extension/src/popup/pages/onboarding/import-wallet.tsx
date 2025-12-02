import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SeedPhraseInput } from '@/components/wallet/seed-phrase-input'
import { validateMnemonic } from '@/lib/background'

export function ImportWalletPage() {
  const navigate = useNavigate()
  const [mnemonic, setMnemonic] = useState<string[]>([])
  const [isValid, setIsValid] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [wordCount, setWordCount] = useState<12 | 24>(24)

  const handleComplete = useCallback((words: string[]) => {
    setMnemonic(words)
    setError('')
  }, [])

  const handleValidChange = useCallback((valid: boolean) => {
    setIsValid(valid)
  }, [])

  const handleImport = async () => {
    if (!isValid || mnemonic.length !== wordCount) {
      setError('Please enter all words')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      const valid = await validateMnemonic(mnemonic)
      if (!valid) {
        setError('Invalid recovery phrase. Please check your words.')
        setIsLoading(false)
        return
      }

      navigate('/set-password', { state: { mnemonic, isNewWallet: false } })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to validate phrase')
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
          Import Wallet
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <p className="text-sm text-slate-600 mb-4 text-center">
          Enter your recovery phrase to restore your wallet
        </p>

        <div className="flex justify-center gap-2 mb-4">
          <button
            onClick={() => setWordCount(12)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              wordCount === 12
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            12 words
          </button>
          <button
            onClick={() => setWordCount(24)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              wordCount === 24
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            24 words
          </button>
        </div>

        <SeedPhraseInput
          key={wordCount}
          wordCount={wordCount}
          onComplete={handleComplete}
          onValidChange={handleValidChange}
        />

        {error && (
          <p className="text-red-500 text-sm mt-4 text-center">{error}</p>
        )}
      </main>

      <div className="p-4 border-t border-slate-100">
        <Button
          onClick={handleImport}
          disabled={!isValid || isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Validating...
            </>
          ) : (
            'Continue'
          )}
        </Button>
      </div>
    </div>
  )
}
