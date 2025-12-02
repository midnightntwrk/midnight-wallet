import { useState } from 'react'
import { ArrowLeft, Copy, Check, Share2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'

const mockAddress = 'midnight1qwertyuiopasdfghjklzxcvbnm123456789'

export function ReceivePage() {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(mockAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function truncateAddress(address: string) {
    return `${address.slice(0, 12)}...${address.slice(-8)}`
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
        <div className="w-48 h-48 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
          <div className="w-40 h-40 bg-white rounded-xl p-2">
            <div className="w-full h-full bg-slate-200 rounded grid grid-cols-8 gap-0.5 p-2">
              {Array.from({ length: 64 }).map((_, i) => (
                <div
                  key={i}
                  className={`aspect-square ${Math.random() > 0.5 ? 'bg-slate-800' : 'bg-white'}`}
                />
              ))}
            </div>
          </div>
        </div>

        <p className="text-sm text-slate-500 mb-2">Your NIGHT Address</p>

        <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-4 py-3 mb-4">
          <code className="text-sm font-mono">
            {truncateAddress(mockAddress)}
          </code>
          <button onClick={handleCopy} className="p-1 hover:bg-slate-200 rounded">
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4 text-slate-500" />
            )}
          </button>
        </div>

        <p className="text-xs text-slate-400 text-center mb-6">
          Only send NIGHT or DUST tokens to this address.<br />
          Sending other assets may result in permanent loss.
        </p>

        <div className="flex gap-3 w-full">
          <Button variant="outline" className="flex-1" onClick={handleCopy}>
            <Copy className="w-4 h-4 mr-2" />
            Copy
          </Button>
          <Button variant="outline" className="flex-1">
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
        </div>
      </div>
    </div>
  )
}
