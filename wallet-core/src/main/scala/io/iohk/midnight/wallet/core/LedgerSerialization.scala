package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.circe.{Decoder, Json}
import io.iohk.midnight.wallet.blockchain.data.Transaction.Header
import io.iohk.midnight.wallet.blockchain.data.{ArbitraryJson, Hash, Transaction}
import io.iohk.midnight.wallet.core.LedgerSerialization.Error.{
  InvalidInitialState,
  InvalidSerializedTransaction,
}
import typings.midnightLedger.mod.{
  TransactionIdentifier,
  ZSwapCoinPublicKey,
  ZSwapLocalState,
  Transaction as LedgerTransaction,
  TransactionHash as LedgerTransactionHash,
}
import typings.node.bufferMod.global.{Buffer, BufferEncoding}

object LedgerSerialization {
  private val HashEncoding = BufferEncoding.hex
  private val BodyEncoding = BufferEncoding.base64

  def serializeState(state: ZSwapLocalState): String =
    state.serialize().toString(BodyEncoding)

  def parseState(raw: String): Either[Throwable, ZSwapLocalState] = {
    val buffer = Buffer.from(raw, BodyEncoding)
    Either
      .catchNonFatal(ZSwapLocalState.deserialize(buffer))
      .leftMap(InvalidInitialState.apply)
  }

  def serializePublicKey(pk: ZSwapCoinPublicKey): String =
    pk.serialize().toString(BodyEncoding)

  def serializeIdentifier(id: TransactionIdentifier): String =
    id.serialize().toString(BodyEncoding)

  def fromTransaction(tx: Transaction): Either[Throwable, LedgerTransaction] =
    Decoder[String]
      .decodeJson(tx.body.value)
      .map(Buffer.from(_, BodyEncoding))
      .flatMap(buffer => Either.catchNonFatal(LedgerTransaction.deserialize(buffer)))
      .leftMap(InvalidSerializedTransaction.apply)

  def toHash(txHash: LedgerTransactionHash): Hash[Transaction] =
    Hash[Transaction](txHash.serialize().toString(HashEncoding))

  def toTransaction(tx: LedgerTransaction): Transaction =
    Transaction(
      Header(toHash(tx.transactionHash())),
      ArbitraryJson(Json.fromString(tx.serialize().toString(BodyEncoding))),
    )

  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
    final case class InvalidSerializedTransaction(cause: Throwable) extends Error(cause)
  }
}
