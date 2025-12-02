import { useEffect, useCallback } from 'react'
import { useWalletStore } from '@/store/wallet-store'
import { getAddress, getBalances, getTransactionHistory } from '@/lib/background'
import { BalanceCard } from '@/components/wallet/balance-card'
import { TransactionList } from '@/components/wallet/transaction-list'

export function HomePage() {
  const {
    balance,
    transactions,
    address,
    isLoading,
    setBalance,
    setTransactions,
    setAddress,
    setLoading,
    setError,
  } = useWalletStore()

  const loadWalletData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const walletAddress = await getAddress()
      setAddress(walletAddress)

      const [balanceData, txHistory] = await Promise.all([
        getBalances(walletAddress),
        getTransactionHistory(walletAddress),
      ])

      setBalance(balanceData)
      setTransactions(txHistory)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load wallet data')
    } finally {
      setLoading(false)
    }
  }, [setAddress, setBalance, setTransactions, setLoading, setError])

  useEffect(() => {
    loadWalletData()
  }, [loadWalletData])

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
