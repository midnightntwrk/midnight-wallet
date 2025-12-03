import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Shield, Globe, X, AlertTriangle } from 'lucide-react'

interface ConnectionData {
  origin: string
}

function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function parseApprovalData(searchParams: URLSearchParams): ConnectionData | null {
  const dataParam = searchParams.get('data')
  if (!dataParam) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(dataParam))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.origin !== 'string') return null
    if (!isValidOrigin(parsed.origin)) return null
    return parsed as ConnectionData
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

function sendApprovalResponse(approved: boolean, origin?: string): void {
  chrome.runtime.sendMessage({
    type: 'APPROVAL_RESPONSE',
    approved,
    origin,
  })
}

export function ApproveConnectionPage() {
  const [searchParams] = useSearchParams()
  const data = parseApprovalData(searchParams)

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-slate-700 font-medium mb-2">Invalid Request</p>
        <p className="text-sm text-slate-500 text-center mb-4">
          This connection request contains invalid data.
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
    sendApprovalResponse(true, data.origin)
  }

  const handleReject = () => {
    sendApprovalResponse(false)
  }

  const hostname = getHostname(data.origin)

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <h1 className="text-lg font-semibold text-slate-900">Connect Request</h1>
        <button
          onClick={handleReject}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center p-6">
        <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mb-4">
          <Globe className="w-8 h-8 text-indigo-600" />
        </div>

        <h2 className="text-xl font-semibold text-slate-900 mb-1">{hostname}</h2>
        <p className="text-sm text-slate-500 mb-6 break-all text-center max-w-full">
          {data.origin}
        </p>

        <div className="w-full bg-slate-50 rounded-xl p-4 mb-6">
          <h3 className="text-sm font-medium text-slate-700 mb-3">
            This site wants to:
          </h3>
          <ul className="space-y-2">
            <li className="flex items-center gap-2 text-sm text-slate-600">
              <Shield className="w-4 h-4 text-indigo-500" />
              View your wallet address
            </li>
            <li className="flex items-center gap-2 text-sm text-slate-600">
              <Shield className="w-4 h-4 text-indigo-500" />
              Request transaction signatures
            </li>
          </ul>
        </div>

        <div className="w-full p-4 bg-amber-50 rounded-xl mb-6">
          <p className="text-xs text-amber-700">
            Only connect to sites you trust. Connecting allows the site to view your address and request approvals.
          </p>
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
            Connect
          </Button>
        </div>
      </div>
    </div>
  )
}
