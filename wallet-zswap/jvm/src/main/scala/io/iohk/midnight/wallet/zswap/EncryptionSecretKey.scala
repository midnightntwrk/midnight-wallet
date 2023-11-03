package io.iohk.midnight.wallet.zswap

import io.iohk.midnight.wallet.jnr.*

import scala.util.Try

final case class EncryptionSecretKey private (data: String, ledger: Ledger) {
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
  def deserialize(data: String, ledger: Ledger): EncryptionSecretKey =
    EncryptionSecretKey(data, ledger)
}
