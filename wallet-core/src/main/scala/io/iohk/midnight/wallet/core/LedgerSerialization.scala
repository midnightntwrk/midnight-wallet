package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.wallet.blockchain.data.{Hash, Transaction}
import io.iohk.midnight.wallet.core.LedgerSerialization.Error.{
  InvalidInitialState,
  InvalidSerializedTransaction,
}
import io.iohk.midnight.wallet.zswap
import java.util.Base64

object LedgerSerialization {
  private def decodeBase64(raw: String): Array[Byte] =
    Base64.getDecoder.decode(raw)
  private def encodeBase64(bytes: Array[Byte]): String =
    Base64.getEncoder.encodeToString(bytes)
  def encodeHex(bytes: Array[Byte]): String =
    bytes.map(b => String.format("%02x", Integer.valueOf(b & 0xff))).mkString
  def decodeHex(raw: String): Array[Byte] =
    raw.grouped(2).map(Integer.parseInt(_, 16).toByte).toArray

  def serializeState(state: zswap.LocalState): String =
    encodeBase64(state.serialize)

  def parseState(raw: String): Either[Throwable, zswap.LocalState] =
    Either
      .catchNonFatal(zswap.LocalState.deserialize(decodeBase64(raw)))
      .leftMap(InvalidInitialState.apply)

  def fromTransaction(tx: Transaction): Either[Throwable, zswap.Transaction] =
    Either
      .catchNonFatal(zswap.Transaction.deserialize(decodeHex(tx.raw)))
      .leftMap(InvalidSerializedTransaction.apply)

  def toTransaction(tx: zswap.Transaction): Transaction =
    Transaction(Hash(tx.hash), encodeHex(tx.serialize))

  def viewingKeyToString(viewingKey: zswap.EncryptionSecretKey): String =
    encodeHex(viewingKey.serialize)

  def fromSeed(seed: String): Either[Throwable, zswap.LocalState] =
    Either
      .catchNonFatal(zswap.LocalState.fromSeed(decodeHex(seed)))
      .leftMap(InvalidInitialState.apply)

  def fromSeedSerialized(seed: String): Either[Throwable, String] = fromSeed(seed).flatMap(state =>
    Either.catchNonFatal(serializeState(state)).leftMap(InvalidInitialState.apply),
  )

  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
    final case class InvalidSerializedTransaction(cause: Throwable) extends Error(cause)
  }
}
