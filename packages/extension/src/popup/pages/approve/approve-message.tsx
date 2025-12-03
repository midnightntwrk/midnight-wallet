import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { PenTool, X, AlertTriangle } from 'lucide-react'

interface MessageData {
  origin: string
  message: string
}

const MAX_MESSAGE_LENGTH = 10000

function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function parseApprovalData(searchParams: URLSearchParams): MessageData | null {
  const dataParam = searchParams.get('data')
  if (!dataParam) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(dataParam))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.origin !== 'string') return null
    if (!isValidOrigin(parsed.origin)) return null
    if (typeof parsed.message !== 'string') return null
    if (parsed.message.length === 0 || parsed.message.length > MAX_MESSAGE_LENGTH) return null
    return parsed as MessageData
  } catch {
    return null
  }
}

function getHostname(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return 'Unknown site'
  }
}

function sendApprovalResponse(approved: boolean): void {
  chrome.runtime.sendMessage({
    type: 'APPROVAL_RESPONSE',
    approved,
  })
}

export function ApproveMessagePage() {
  const [searchParams] = useSearchParams()
  const data = parseApprovalData(searchParams)

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-slate-700 font-medium mb-2">Invalid Request</p>
        <p className="text-sm text-slate-500 text-center mb-4">
          This signing request contains invalid data.
        </p>
        <Button
          variant="outline"
          onClick={() => window.close()}
        >
          Close
        </Button>
      </div>
    )
  }

  const handleApprove = () => {
    sendApprovalResponse(true)
  }

  const handleReject = () => {
    sendApprovalResponse(false)
  }

  const hostname = getHostname(data.origin)

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <h1 className="text-lg font-semibold text-slate-900">Sign Message</h1>
        <button
          onClick={handleReject}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 flex flex-col p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center">
            <PenTool className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-900">{hostname}</p>
            <p className="text-xs text-slate-500">wants you to sign a message</p>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 mb-4">
          <p className="text-xs text-slate-500 mb-2">Message to sign:</p>
          <div className="bg-white rounded-lg p-3 border border-slate-200 max-h-48 overflow-y-auto">
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words font-mono">
              {data.message}
            </p>
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-700">
            <p className="font-medium mb-1">Be careful signing messages</p>
            <p>
              Signing this message can have dangerous effects. Only sign messages from sites you trust completely.
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-slate-100">
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleReject}
          >
            Cancel
          </Button>
          <Button
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            onClick={handleApprove}
          >
            Sign
          </Button>
        </div>
      </div>
    </div>
  )
}
