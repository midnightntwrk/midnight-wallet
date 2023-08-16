package io.iohk.midnight.wallet.jnr

trait Ledger {
  def isTransactionRelevant(
      tx: String,
      encryptionKeySerialized: String,
  ): LedgerResult

  def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[LedgerError, String]
}
