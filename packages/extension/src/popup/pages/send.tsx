import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SendConfirmDialog } from '@/components/wallet/send-confirm-dialog'
import { useWalletStore } from '@/store/wallet-store'
import { sendTokenTransaction, getAddress, getBalances } from '@/lib/background'
import { formatAmount, parseAmount, isValidMidnightAddress } from '@/lib/format'

export function SendPage() {
  const navigate = useNavigate()
  const { balance, setBalance, isSending, setSending } = useWalletStore()

  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [txType, setTxType] = useState<'shielded' | 'unshielded'>('shielded')
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [txHash, setTxHash] = useState<string>('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    async function loadBalance() {
      try {
        const address = await getAddress()
        const balanceData = await getBalances(address)
        setBalance(balanceData)
      } catch {}
    }
    if (!balance) loadBalance()
  }, [balance, setBalance])

  const availableBalance = balance
    ? txType === 'shielded'
      ? balance.shielded
      : balance.unshielded
    : '0'

  const handleAmountChange = (value: string) => {
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setAmount(value)
      setValidationError(null)
    }
  }

  const handleMaxClick = () => {
    setAmount(formatAmount(availableBalance))
  }

  const validateForm = (): boolean => {
    if (!recipient) {
      setValidationError('Recipient address is required')
      return false
    }

    if (!isValidMidnightAddress(recipient)) {
      setValidationError('Invalid Midnight address')
      return false
    }

    if (!amount || parseFloat(amount) <= 0) {
      setValidationError('Amount must be greater than 0')
      return false
    }

    try {
      const amountBigInt = parseAmount(amount)
      if (amountBigInt > BigInt(availableBalance)) {
        setValidationError('Insufficient balance')
        return false
      }
    } catch {
      setValidationError('Invalid amount')
      return false
    }

    setValidationError(null)
    return true
  }

  const handleContinue = () => {
    if (validateForm()) {
      setShowConfirm(true)
      setError(null)
      setSuccess(false)
    }
  }

  const handleConfirm = async () => {
    setSending(true)
    setError(null)

    try {
      const amountStr = parseAmount(amount).toString()
      const result = await sendTokenTransaction({
        to: recipient,
        amount: amountStr,
        type: txType,
      })

      setTxHash(result.txHash)
      setSuccess(true)

      const address = await getAddress()
      const newBalance = await getBalances(address)
      setBalance(newBalance)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setSending(false)
    }
  }

  const handleDialogClose = (open: boolean) => {
    if (!open && success) {
      navigate('/home')
    }
    setShowConfirm(open)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <button onClick={() => navigate(-1)} className="p-1 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold">Send</h1>
      </div>

      <div className="flex-1 p-4 overflow-auto">
        <div className="mb-4">
          <label className="text-sm text-slate-500 mb-2 block">Recipient Address</label>
          <Input
            placeholder="midnight1..."
            value={recipient}
            onChange={(e) => {
              setRecipient(e.target.value)
              setValidationError(null)
            }}
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-slate-500 mb-2 block">Transaction Type</label>
          <div className="flex gap-2">
            <button
              onClick={() => setTxType('shielded')}
              className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-colors ${
                txType === 'shielded'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Shielded
            </button>
            <button
              onClick={() => setTxType('unshielded')}
              className={`flex-1 py-2 px-3 rounded-xl text-sm font-medium transition-colors ${
                txType === 'unshielded'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Unshielded
            </button>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-sm text-slate-500 mb-2 block">Amount</label>
          <div className="relative">
            <Input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => handleAmountChange(e.target.value)}
              className="pr-16"
            />
            <button
              onClick={handleMaxClick}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-indigo-600 font-medium hover:text-indigo-700"
            >
              MAX
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Available: {formatAmount(availableBalance)} tDUST ({txType})
          </p>
        </div>

        {validationError && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
            <p className="text-sm text-red-700">{validationError}</p>
          </div>
        )}

        <div className="bg-slate-50 rounded-xl p-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-500">Network Fee</span>
            <span>~0.001 tDUST</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Total</span>
            <span className="font-medium">{amount || '0'} tDUST</span>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-slate-100">
        <Button
          onClick={handleContinue}
          disabled={!recipient || !amount}
          className="w-full"
          size="lg"
        >
          Continue
        </Button>
      </div>

      <SendConfirmDialog
        open={showConfirm}
        onOpenChange={handleDialogClose}
        recipient={recipient}
        amount={amount ? parseAmount(amount).toString() : '0'}
        type={txType}
        onConfirm={handleConfirm}
        isLoading={isSending}
        error={error}
        success={success}
        txHash={txHash}
      />
    </div>
  )
}
