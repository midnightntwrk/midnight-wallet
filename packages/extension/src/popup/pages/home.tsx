import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWalletStore } from '@/store/wallet-store'
import { getAddress, getBalances, getTransactionHistory } from '@/lib/background'
import { BalanceCard } from '@/components/wallet/balance-card'
import { TransactionList } from '@/components/wallet/transaction-list'

export function HomePage() {
  const navigate = useNavigate()
  const {
    balance,
    transactions,
    isLoading,
    setBalance,
    setTransactions,
    setAddress,
    setLoading,
    setError,
  } = useWalletStore()

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true

    async function loadWalletData() {
      setLoading(true)
      setError(null)

      try {
        const walletAddress = await getAddress()
        if (!mountedRef.current) return
        setAddress(walletAddress)

        const [balanceData, txHistory] = await Promise.all([
          getBalances(walletAddress),
          getTransactionHistory(walletAddress),
        ])

        if (!mountedRef.current) return
        setBalance(balanceData)
        setTransactions(txHistory)
      } catch (err) {
        if (!mountedRef.current) return
        const message = err instanceof Error ? err.message.toLowerCase() : ''
        if (message.includes('locked') || message.includes('seed')) {
          navigate('/unlock', { replace: true })
          return
        }
        setError(err instanceof Error ? err.message : 'Failed to load wallet data')
      } finally {
        if (mountedRef.current) {
          setLoading(false)
        }
      }
    }

    loadWalletData()

    return () => {
      mountedRef.current = false
    }
  }, [setAddress, setBalance, setTransactions, setLoading, setError, navigate])

  return (
    <div className="px-4 py-4">
      <BalanceCard balance={balance} isLoading={isLoading} />

      <TransactionList
        transactions={transactions}
        isLoading={isLoading}
        limit={5}
        showSeeAll
        onSeeAll={() => {}}
      />
    </div>
  )
}
