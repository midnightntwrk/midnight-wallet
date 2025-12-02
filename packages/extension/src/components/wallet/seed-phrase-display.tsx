import { useState } from 'react'
import { Copy, CheckCircle, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface SeedPhraseDisplayProps {
  words: string[]
  onConfirm?: () => void
  showCopyButton?: boolean
}

export function SeedPhraseDisplay({
  words,
  onConfirm,
  showCopyButton = true,
}: SeedPhraseDisplayProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(words.join(' '))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      console.error('Failed to copy to clipboard')
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-amber-800">
          <p className="font-medium mb-1">Write down your recovery phrase</p>
          <p className="text-amber-700">
            Store it in a secure location. Anyone with this phrase can access your wallet.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 p-4 bg-slate-50 rounded-xl">
        {words.map((word, index) => (
          <div
            key={index}
            className="flex items-center gap-2 px-2 py-1.5 bg-white rounded-lg border border-slate-200"
          >
            <span className="text-xs text-slate-400 w-5 text-right">
              {index + 1}.
            </span>
            <span className="text-sm font-medium text-slate-700">{word}</span>
          </div>
        ))}
      </div>

      {showCopyButton && (
        <Button
          variant="outline"
          className="w-full"
          onClick={handleCopy}
          disabled={copied}
        >
          {copied ? (
            <>
              <CheckCircle className="w-4 h-4 mr-2 text-green-600" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4 mr-2" />
              Copy to Clipboard
            </>
          )}
        </Button>
      )}

      {onConfirm && (
        <Button onClick={onConfirm} className="w-full">
          I&apos;ve Written It Down
        </Button>
      )}
    </div>
  )
}
