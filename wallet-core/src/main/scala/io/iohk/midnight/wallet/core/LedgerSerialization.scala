package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.{Hash, Transaction}
import io.iohk.midnight.wallet.core.LedgerSerialization.Error.{
  InvalidInitialState,
  InvalidSerializedTransaction,
}
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.HexUtil
import java.util.Base64

object LedgerSerialization {
  private def decodeBase64(raw: String): Array[Byte] =
    Base64.getDecoder.decode(raw)
  private def encodeBase64(bytes: Array[Byte]): String =
    Base64.getEncoder.encodeToString(bytes)

  def serializeState(state: zswap.LocalState): String =
    encodeBase64(state.serialize)

  def parseState(raw: String): Either[Throwable, zswap.LocalState] =
    Either
      .catchNonFatal(zswap.LocalState.deserialize(decodeBase64(raw)))
      .leftMap(InvalidInitialState.apply)

  def fromTransaction(tx: Transaction): Either[Throwable, zswap.Transaction] =
    HexUtil.decodeHex(tx.raw).toEither.flatMap { decoded =>
      Either
        .catchNonFatal(zswap.Transaction.deserialize(decoded))
        .leftMap(InvalidSerializedTransaction.apply)
    }

  def toTransaction(tx: zswap.Transaction): Transaction =
    Transaction(Hash(tx.hash), tx.serialize)

  def fromSeed(seed: String): Either[Throwable, zswap.LocalState] =
    HexUtil.decodeHex(seed).toEither.flatMap { decoded =>
      Either
        .catchNonFatal(zswap.LocalState.fromSeed(decoded))
        .leftMap(InvalidInitialState.apply)
    }

  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
    final case class InvalidSerializedTransaction(cause: Throwable) extends Error(cause)
  }
}
