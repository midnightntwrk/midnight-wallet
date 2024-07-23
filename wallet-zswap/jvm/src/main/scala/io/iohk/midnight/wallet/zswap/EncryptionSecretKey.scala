package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.*
import scala.util.{Failure, Success, Try}

final case class EncryptionSecretKey private (data: String, ledger: LedgerV1) {
  def serialize: String = data

  def test(tx: Transaction): Try[Boolean] = {
    val serializedTx = tx.serialize
    val serializedKey = this.serialize

    ledger
      .isTransactionRelevant(serializedTx, serializedKey)
      .left
      .map(errors => Exception(errors.toList.map(_.getMessage).mkString(", ")))
      .toTry
      .map(_.booleanData)
  }
}

object EncryptionSecretKey {
  def deserialize(data: String, ledger: LedgerV1): Try[EncryptionSecretKey] =
    ledger
      .tryDeserializeEncryptionKey(data)
      .fold(
        errors => Failure(Throwable(errors.map(_.getMessage).toList.mkString(" | "))),
        result => Success(EncryptionSecretKey(result.data, ledger)),
      )
}
