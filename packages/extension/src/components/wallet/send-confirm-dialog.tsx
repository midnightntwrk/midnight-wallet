import { AlertCircle, Loader2, CheckCircle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { formatAmount, truncateAddress } from '@/lib/format'

interface SendConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  recipient: string
  amount: string
  type: 'shielded' | 'unshielded'
  onConfirm: () => void
  isLoading?: boolean
  error?: string | null
  success?: boolean
  txHash?: string
}

export function SendConfirmDialog({
  open,
  onOpenChange,
  recipient,
  amount,
  type,
  onConfirm,
  isLoading,
  error,
  success,
  txHash,
}: SendConfirmDialogProps) {
  const handleClose = () => {
    if (!isLoading) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {success ? 'Transaction Sent' : 'Confirm Transaction'}
          </DialogTitle>
          <DialogDescription>
            {success
              ? 'Your transaction has been submitted'
              : 'Review your transaction details'}
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center py-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <p className="text-sm text-slate-600 mb-2">Transaction Hash</p>
            <code className="text-xs bg-slate-100 px-3 py-2 rounded-lg font-mono break-all">
              {txHash ? truncateAddress(txHash, 20, 20) : '...'}
            </code>
            <Button onClick={handleClose} className="w-full mt-6">
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4 py-4">
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Amount</span>
                  <span className="font-medium">
                    {formatAmount(amount)} tDUST
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">To</span>
                  <span className="font-mono text-sm">
                    {truncateAddress(recipient)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Type</span>
                  <span className="capitalize">{type}</span>
                </div>
                <div className="border-t border-slate-200 pt-3 flex justify-between">
                  <span className="text-sm text-slate-500">Network Fee</span>
                  <span className="text-sm">~0.001 tDUST</span>
                </div>
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-amber-700">
                  Please verify the recipient address. Transactions cannot be
                  reversed.
                </p>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isLoading}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={onConfirm}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  'Confirm'
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
