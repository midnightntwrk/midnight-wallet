import { useState, useEffect } from 'react'
import { ArrowLeft, Copy, Check, Share2, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { QRCode } from '@/components/wallet/qr-code'
import { useWalletStore } from '@/store/wallet-store'
import { getAddress } from '@/lib/background'
import { truncateAddress } from '@/lib/format'

export function ReceivePage() {
  const navigate = useNavigate()
  const { address, setAddress } = useWalletStore()
  const [copied, setCopied] = useState(false)
  const [isLoading, setIsLoading] = useState(!address)

  useEffect(() => {
    async function loadAddress() {
      if (address) return

      setIsLoading(true)
      try {
        const walletAddress = await getAddress()
        setAddress(walletAddress)
      } catch {
      } finally {
        setIsLoading(false)
      }
    }
    loadAddress()
  }, [address, setAddress])

  async function handleCopy() {
    if (!address) return
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleShare() {
    if (!address || !navigator.share) return

    try {
      await navigator.share({
        title: 'My Midnight Address',
        text: address,
      })
    } catch {}
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <button onClick={() => navigate(-1)} className="p-1 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold">Receive</h1>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {isLoading ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            <p className="text-sm text-slate-500">Loading address...</p>
          </div>
        ) : address ? (
          <>
            <div className="mb-6">
              <QRCode value={address} size={200} />
            </div>

            <p className="text-sm text-slate-500 mb-2">Your tDUST Address</p>

            <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-4 py-3 mb-4 max-w-full">
              <code className="text-sm font-mono truncate">
                {truncateAddress(address, 12, 8)}
              </code>
              <button
                onClick={handleCopy}
                className="p-1 hover:bg-slate-200 rounded flex-shrink-0"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-500" />
                )}
              </button>
            </div>

            <p className="text-xs text-slate-400 text-center mb-6">
              Only send tDUST tokens to this address on testnet.
              <br />
              Sending other assets may result in permanent loss.
            </p>

            <div className="flex gap-3 w-full max-w-xs">
              <Button variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="w-4 h-4 mr-2" />
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              {typeof navigator.share === 'function' && (
                <Button variant="outline" className="flex-1" onClick={handleShare}>
                  <Share2 className="w-4 h-4 mr-2" />
                  Share
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="text-center">
            <p className="text-slate-500">Could not load address</p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
