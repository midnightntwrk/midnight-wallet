package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.LedgerSerialization.Error.InvalidInitialState
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.HexUtil

class LedgerSerialization[LocalState, Transaction](using
    zswap.Transaction.IsSerializable[Transaction],
    zswap.Transaction.Transaction[Transaction, ?],
)(using
    ls: zswap.LocalState.IsSerializable[LocalState],
) {
  def toTransaction(tx: Transaction)(using zswap.NetworkId): data.Transaction =
    data.Transaction(data.Hash(tx.hash), tx.serialize)

  def fromSeed(seed: String): Either[Throwable, LocalState] =
    HexUtil.decodeHex(seed).toEither.flatMap { decoded =>
      Either
        .catchNonFatal(ls.fromSeed(decoded))
        .leftMap(InvalidInitialState.apply)
    }
}

object LedgerSerialization {
  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
  }
}
