package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.{Hash, ProtocolVersion, Transaction}
import io.iohk.midnight.wallet.core.LedgerSerialization.Error.InvalidInitialState
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.HexUtil

object LedgerSerialization {
  def toTransaction(tx: zswap.Transaction)(using zswap.NetworkId): Transaction =
    Transaction(Hash(tx.hash), tx.serialize)

  def fromSeed(seed: String, version: ProtocolVersion): Either[Throwable, zswap.LocalState] =
    HexUtil.decodeHex(seed).toEither.flatMap { decoded =>
      Either
        .catchNonFatal(zswap.LocalState.fromSeed(decoded, version))
        .leftMap(InvalidInitialState.apply)
    }

  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
  }
}
