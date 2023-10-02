package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.*
import scala.util.{Failure, Success, Try}

final case class EncryptionSecretKey private (bytes: Array[Byte], ledger: Ledger) {
  def serialize: Array[Byte] = bytes

  def test(tx: Transaction): Try[Boolean] = {
    val serializedTx = HexUtil.encodeHex(tx.serialize)
    val serializedKey = HexUtil.encodeHex(bytes)
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
  def deserialize(bytes: Array[Byte]): Try[EncryptionSecretKey] =
    Ledger.instance.flatMap(deserialize(bytes, _))

  def deserialize(bytes: Array[Byte], ledger: Ledger): Try[EncryptionSecretKey] =
    Success(EncryptionSecretKey(bytes, ledger))
}
