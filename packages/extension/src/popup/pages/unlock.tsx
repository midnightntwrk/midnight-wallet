import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Moon, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useWalletStore } from '@/store/wallet-store'
import { unlock, getWallets, getState } from '@/lib/background'

export function UnlockPage() {
  const navigate = useNavigate()
  const { setUnlocked, setActiveWallet, setWallets, wallets } = useWalletStore()

  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    checkState()
  }, [])

  async function checkState() {
    try {
      const state = await getState()
      if (!state.isLocked && state.activeWalletId) {
        setUnlocked(true)
        navigate('/home', { replace: true })
        return
      }

      const walletList = await getWallets()
      setWallets(walletList)

      if (walletList.length === 0) {
        navigate('/welcome', { replace: true })
      }
    } catch (err) {
      console.error('Failed to check state:', err)
    }
  }

  async function handleUnlock() {
    if (!password.trim()) {
      setError('Please enter your password')
      return
    }

    if (wallets.length === 0) {
      setError('No wallet found')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      await unlock(password, wallets[0].id)
      setUnlocked(true)
      setActiveWallet(wallets[0])
      navigate('/home', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlock')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <main className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center mb-6 shadow-lg">
          <Moon className="w-10 h-10 text-white" />
        </div>

        <h1 className="text-2xl font-bold mb-2">Welcome Back</h1>
        <p className="text-slate-500 text-center mb-8">
          Enter your password to unlock your wallet
        </p>

        <div className="w-full mb-4">
          <div className="relative">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              className="pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-100 rounded"
            >
              {showPassword ? (
                <EyeOff className="w-5 h-5 text-slate-400" />
              ) : (
                <Eye className="w-5 h-5 text-slate-400" />
              )}
            </button>
          </div>
          {error && (
            <p className="text-red-500 text-sm mt-2">{error}</p>
          )}
        </div>

        <Button
          onClick={handleUnlock}
          disabled={isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? 'Unlocking...' : 'Unlock'}
        </Button>
      </main>

      <div className="p-4 text-center">
        <p className="text-xs text-slate-400">
          Locked after 15 minutes of inactivity
        </p>
      </div>
    </div>
  )
}
