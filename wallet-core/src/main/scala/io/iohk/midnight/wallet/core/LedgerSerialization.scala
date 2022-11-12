package io.iohk.midnight.wallet.core

import io.circe.{Decoder, DecodingFailure, Json}
import io.iohk.midnight.wallet.blockchain.data.Transaction.Header
import io.iohk.midnight.wallet.blockchain.data.{ArbitraryJson, Hash, Transaction}
import typings.midnightLedger.mod.Transaction as LedgerTransaction
import typings.node.bufferMod.Buffer
import typings.node.bufferMod.global.BufferEncoding

object LedgerSerialization {
  private val Encoding = BufferEncoding.hex

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
}
