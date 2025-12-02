import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SendPage() {
  const navigate = useNavigate()
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [selectedToken, setSelectedToken] = useState('NIGHT')

  function handleSend() {
    console.log('Sending:', { recipient, amount, selectedToken })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <button onClick={() => navigate(-1)} className="p-1 hover:bg-slate-100 rounded">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="font-semibold">Send</h1>
      </div>

      <div className="flex-1 p-4">
        <div className="mb-4">
          <label className="text-sm text-slate-500 mb-2 block">Recipient Address</label>
          <Input
            placeholder="Enter midnight address"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </div>

        <div className="mb-4">
          <label className="text-sm text-slate-500 mb-2 block">Token</label>
          <button className="w-full flex items-center justify-between p-3 border border-slate-200 rounded-xl hover:bg-slate-50">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-600 font-bold text-sm">
                {selectedToken[0]}
              </div>
              <span className="font-medium">{selectedToken}</span>
            </div>
            <ChevronDown className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="mb-4">
          <label className="text-sm text-slate-500 mb-2 block">Amount</label>
          <div className="relative">
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="pr-16"
            />
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-indigo-600 font-medium">
              MAX
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Available: 125.50 {selectedToken}</p>
        </div>

        <div className="bg-slate-50 rounded-xl p-4 mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-500">Network Fee</span>
            <span>0.001 DUST</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Total</span>
            <span className="font-medium">{amount || '0'} {selectedToken}</span>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-slate-100">
        <Button
          onClick={handleSend}
          disabled={!recipient || !amount}
          className="w-full"
          size="lg"
        >
          Continue
        </Button>
      </div>
    </div>
  )
}
