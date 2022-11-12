package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.circe.{Decoder, DecodingFailure, Json}
import io.iohk.midnight.wallet.blockchain.data.Transaction.Header
import io.iohk.midnight.wallet.blockchain.data.{ArbitraryJson, Hash, Transaction}
import io.iohk.midnight.wallet.core.LedgerSerialization.Error.InvalidInitialState
import typings.midnightLedger.mod.{ZSwapLocalState, Transaction as LedgerTransaction}
import typings.node.bufferMod.global.{Buffer, BufferEncoding}

object LedgerSerialization {
  private val Encoding = BufferEncoding.hex

  def serializeState(state: ZSwapLocalState): String =
    state.serialize().toString(Encoding)

  def parseState(raw: String): Either[Throwable, ZSwapLocalState] = {
    val buffer = Buffer.from(raw, Encoding)
    Either
      .catchNonFatal(ZSwapLocalState.deserialize(buffer))
      .leftMap(InvalidInitialState.apply)
  }

  def fromTransaction(tx: Transaction): Either[DecodingFailure, LedgerTransaction] =
    Decoder[String]
      .decodeJson(tx.body.value)
      .map(Buffer.from(_, Encoding))
      .map(LedgerTransaction.deserialize)

  def toTransaction(tx: LedgerTransaction): Transaction =
    Transaction(
      Header(Hash(tx.transactionHash().serialize().toString(Encoding))),
      ArbitraryJson(Json.fromString(tx.serialize().toString(Encoding))),
    )

  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
  }
}
