package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.zswap

class LedgerSerialization[LocalStateNoKeys, Transaction](using
    zswap.Transaction.IsSerializable[Transaction],
    zswap.Transaction.Transaction[Transaction, ?],
) {
  def toTransaction(tx: Transaction)(using zswap.NetworkId): data.Transaction =
    data.Transaction(data.Hash(tx.hash), tx.serialize)
}

object LedgerSerialization {
  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
  }
}
