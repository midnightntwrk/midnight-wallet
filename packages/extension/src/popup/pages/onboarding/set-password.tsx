import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, Eye, EyeOff, Loader2, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createWallet, importWallet, unlock } from '@/lib/background'
import { useWalletStore } from '@/store/wallet-store'

export function SetPasswordPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { setUnlocked, setActiveWallet, setWallets } = useWalletStore()

  const { mnemonic, isNewWallet } = (location.state as {
    mnemonic: string[]
    isNewWallet: boolean
  }) || { mnemonic: [], isNewWallet: true }

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const passwordStrength = getPasswordStrength(password)
  const passwordsMatch = password === confirmPassword && password.length > 0

  const handleSubmit = async () => {
    if (!password || !confirmPassword) {
      setError('Please fill in all fields')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (!mnemonic || mnemonic.length === 0) {
      setError('Recovery phrase not found')
      return
    }

    setIsLoading(true)
    setError('')

    try {
      let wallet: { id: string; name: string; createdAt: number }

      if (isNewWallet) {
        wallet = await createWallet('My Wallet', password, mnemonic.join(' '))
      } else {
        wallet = await importWallet('Imported Wallet', password, mnemonic.join(' '))
      }

      await unlock(password, wallet.id)
      setUnlocked(true)
      setActiveWallet(wallet)
      setWallets([wallet])

      navigate('/home', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center px-4 py-3 border-b border-slate-100">
        <button
          onClick={() => {
            if (isNewWallet) {
              navigate('/confirm-seed', { state: { mnemonic, isNewWallet } })
            } else {
              navigate('/import-wallet')
            }
          }}
          className="p-2 -ml-2 hover:bg-slate-100 rounded-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-lg font-semibold text-center mr-7">
          Set Password
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mb-6">
          <h2 className="text-center text-lg font-semibold mb-1">
            Create a Password
          </h2>
          <p className="text-center text-sm text-slate-500">
            This password will be used to unlock your wallet
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Password
            </label>
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
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
            {password.length > 0 && (
              <div className="mt-2">
                <div className="flex gap-1 mb-1">
                  {[1, 2, 3, 4].map((level) => (
                    <div
                      key={level}
                      className={`h-1 flex-1 rounded ${
                        level <= passwordStrength.level
                          ? passwordStrength.color
                          : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <p className={`text-xs ${passwordStrength.textColor}`}>
                  {passwordStrength.label}
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Confirm Password
            </label>
            <div className="relative">
              <Input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="pr-12"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-100 rounded"
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-5 h-5 text-slate-400" />
                ) : (
                  <Eye className="w-5 h-5 text-slate-400" />
                )}
              </button>
            </div>
            {confirmPassword.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                {passwordsMatch ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-xs text-green-600">Passwords match</span>
                  </>
                ) : (
                  <span className="text-xs text-red-500">Passwords do not match</span>
                )}
              </div>
            )}
          </div>
        </div>

        {error && (
          <p className="text-red-500 text-sm mt-4 text-center">{error}</p>
        )}
      </main>

      <div className="p-4 border-t border-slate-100">
        <Button
          onClick={handleSubmit}
          disabled={!passwordsMatch || password.length < 8 || isLoading}
          className="w-full"
          size="lg"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Creating Wallet...
            </>
          ) : (
            'Create Wallet'
          )}
        </Button>
      </div>
    </div>
  )
}

function getPasswordStrength(password: string): {
  level: number
  label: string
  color: string
  textColor: string
} {
  let score = 0

  if (password.length >= 8) score++
  if (password.length >= 12) score++
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^A-Za-z0-9]/.test(password)) score++

  if (score <= 1) {
    return { level: 1, label: 'Weak', color: 'bg-red-500', textColor: 'text-red-500' }
  } else if (score === 2) {
    return { level: 2, label: 'Fair', color: 'bg-orange-500', textColor: 'text-orange-500' }
  } else if (score === 3) {
    return { level: 3, label: 'Good', color: 'bg-yellow-500', textColor: 'text-yellow-600' }
  } else {
    return { level: 4, label: 'Strong', color: 'bg-green-500', textColor: 'text-green-600' }
  }
}
