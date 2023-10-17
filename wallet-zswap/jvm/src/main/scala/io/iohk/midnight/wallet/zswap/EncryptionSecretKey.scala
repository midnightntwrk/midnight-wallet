package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.*
import scala.util.{Failure, Success, Try}

final case class EncryptionSecretKey private (data: String, ledger: Ledger) {
  def serialize: String = data

  def test(tx: Transaction): Try[Boolean] = {
    val serializedTx = tx.serialize
    val serializedKey = this.serialize
    ledger.isTransactionRelevant(serializedTx, serializedKey) match {
      case LedgerSuccess.OperationTrue  => Success(true)
      case LedgerSuccess.OperationFalse => Success(false)
      case LedgerResult.UnknownCode(code) =>
        Failure(Exception(s"Unknown code received: $code"))
      case error: LedgerError =>
        Failure(Exception(s"Ledger error received: $error"))
    }
  }
}

object EncryptionSecretKey {
  def deserialize(data: String, ledger: Ledger): EncryptionSecretKey =
    EncryptionSecretKey(data, ledger)
}
