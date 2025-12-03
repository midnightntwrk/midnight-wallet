import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Eye, EyeOff, AlertTriangle, Copy, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWalletStore } from '@/store/wallet-store'
import { useUIStore } from '@/store/ui-store'
import { exportSeed } from '@/lib/background'

export function ExportSeedPage() {
  const navigate = useNavigate()
  const { activeWallet } = useWalletStore()
  const { showToast } = useUIStore()

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [seedPhrase, setSeedPhrase] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function handleExport() {
    if (!password.trim()) {
      setError('Password is required')
      return
    }

    if (!activeWallet) {
      setError('No wallet selected')
      return
    }

    setLoading(true)
    setError('')

    try {
      const words = await exportSeed(password, activeWallet.id)
      setSeedPhrase(words)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid password')
    } finally {
      setLoading(false)
    }
  }

  async function handleCopy() {
    if (!seedPhrase) return
    try {
      await navigator.clipboard.writeText(seedPhrase.join(' '))
      setCopied(true)
      showToast('Seed phrase copied', 'success')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('Failed to copy', 'error')
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 p-4 border-b border-slate-100">
        <button
          onClick={() => navigate('/settings')}
          className="p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">Export Seed Phrase</h1>
      </div>

      <div className="flex-1 p-4 space-y-4">
        <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">Keep your seed phrase safe!</p>
            <p className="text-amber-700">
              Never share it with anyone. Anyone with your seed phrase can access your funds.
            </p>
          </div>
        </div>

        {!seedPhrase ? (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Enter your password to reveal
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setError('')
                  }}
                  placeholder="Enter password"
                  className={error ? 'border-red-500' : ''}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
            </div>

            <Button
              onClick={handleExport}
              disabled={loading || !password.trim()}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                'Reveal Seed Phrase'
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-xl p-4">
              <div className="grid grid-cols-3 gap-2">
                {seedPhrase.map((word, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 bg-white rounded-lg px-2 py-1.5 border border-slate-200"
                  >
                    <span className="text-xs text-slate-400 w-4">{index + 1}</span>
                    <span className="text-sm font-medium">{word}</span>
                  </div>
                ))}
              </div>
            </div>

            <Button variant="outline" onClick={handleCopy} className="w-full">
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy Seed Phrase
                </>
              )}
            </Button>

            <Button
              variant="ghost"
              onClick={() => {
                setSeedPhrase(null)
                setPassword('')
              }}
              className="w-full"
            >
              Hide Seed Phrase
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
