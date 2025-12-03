import { useSearchParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ArrowUpRight, Shield, X, AlertTriangle } from 'lucide-react'
import { truncateAddress } from '@/lib/format'

interface TransactionParams {
  to: string
  amount: string
  type: 'shielded' | 'unshielded'
  memo?: string
}

interface TransactionData {
  origin: string
  transaction: TransactionParams
}

function isValidOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function isValidTransaction(tx: unknown): tx is TransactionParams {
  if (!tx || typeof tx !== 'object') return false
  const t = tx as Record<string, unknown>
  if (typeof t['to'] !== 'string' || (t['to'] as string).length < 10) return false
  if (typeof t['amount'] !== 'string' || !/^\d+(\.\d+)?$/.test(t['amount'] as string)) return false
  if (t['type'] !== 'shielded' && t['type'] !== 'unshielded') return false
  if (t['memo'] !== undefined && typeof t['memo'] !== 'string') return false
  return true
}

function parseApprovalData(searchParams: URLSearchParams): TransactionData | null {
  const dataParam = searchParams.get('data')
  if (!dataParam) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(dataParam))
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.origin !== 'string') return null
    if (!isValidOrigin(parsed.origin)) return null
    if (!isValidTransaction(parsed.transaction)) return null
    return parsed as TransactionData
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

export function ApproveTransactionPage() {
  const [searchParams] = useSearchParams()
  const data = parseApprovalData(searchParams)

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-slate-700 font-medium mb-2">Invalid Request</p>
        <p className="text-sm text-slate-500 text-center mb-4">
          This transaction request contains invalid data.
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

  const { transaction } = data
  const hostname = getHostname(data.origin)
  const isShielded = transaction.type === 'shielded'

  return (
    <div className="flex flex-col min-h-screen bg-white">
      <div className="flex items-center justify-between p-4 border-b border-slate-100">
        <h1 className="text-lg font-semibold text-slate-900">Confirm Transaction</h1>
        <button
          onClick={handleReject}
          className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
        >
          <X className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      <div className="flex-1 flex flex-col p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center">
            <ArrowUpRight className="w-4 h-4 text-slate-600" />
          </div>
          <div>
            <p className="text-sm text-slate-500">From</p>
            <p className="text-sm font-medium text-slate-900">{hostname}</p>
          </div>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 mb-4">
          <div className="flex justify-between items-start mb-4">
            <span className="text-sm text-slate-500">Amount</span>
            <div className="text-right">
              <p className="text-xl font-bold text-slate-900">{transaction.amount} tDUST</p>
              <p className="text-xs text-slate-400">
                {isShielded ? 'Shielded' : 'Unshielded'} Transfer
              </p>
            </div>
          </div>

          <div className="flex justify-between items-center py-3 border-t border-slate-200">
            <span className="text-sm text-slate-500">To</span>
            <span className="text-sm font-mono text-slate-700">
              {truncateAddress(transaction.to)}
            </span>
          </div>

          {transaction.memo && (
            <div className="flex justify-between items-center py-3 border-t border-slate-200">
              <span className="text-sm text-slate-500">Memo</span>
              <span className="text-sm text-slate-700 max-w-[180px] truncate">
                {transaction.memo}
              </span>
            </div>
          )}

          <div className="flex justify-between items-center py-3 border-t border-slate-200">
            <span className="text-sm text-slate-500">Privacy</span>
            <div className="flex items-center gap-1">
              <Shield className={`w-4 h-4 ${isShielded ? 'text-green-500' : 'text-slate-400'}`} />
              <span className="text-sm text-slate-700">
                {isShielded ? 'Private' : 'Public'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            Review the details carefully. Once confirmed, the transaction cannot be reversed.
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
            Reject
          </Button>
          <Button
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
            onClick={handleApprove}
          >
            Confirm
          </Button>
        </div>
      </div>
    </div>
  )
}
