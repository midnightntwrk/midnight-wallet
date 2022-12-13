package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.iohk.midnight.midnightLedger.mod.{
  TransactionIdentifier,
  ZSwapCoinPublicKey,
  ZSwapLocalState,
  Transaction as LedgerTransaction,
  TransactionHash as LedgerTransactionHash,
}
import io.iohk.midnight.wallet.blockchain.data.Transaction.Header
import io.iohk.midnight.wallet.blockchain.data.{Hash, Transaction}
import io.iohk.midnight.wallet.core.LedgerSerialization.Error.{
  InvalidInitialState,
  InvalidSerializedTransaction,
}
import io.scalajs.nodejs.buffer.Buffer

@SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
object LedgerSerialization {
  private val HashEncoding = "hex"
  private val BodyEncoding = "base64"

  def serializeState(state: ZSwapLocalState): String =
    state.serialize().asInstanceOf[Buffer].toString(BodyEncoding)

  def parseState(raw: String): Either[Throwable, ZSwapLocalState] = {
    val buffer = Buffer.from(raw, BodyEncoding)
    Either
      .catchNonFatal(ZSwapLocalState.deserialize(buffer))
      .leftMap(InvalidInitialState.apply)
  }

  def serializePublicKey(pk: ZSwapCoinPublicKey): String =
    pk.serialize().asInstanceOf[Buffer].toString(BodyEncoding)

  def serializeIdentifier(id: TransactionIdentifier): String =
    id.serialize().asInstanceOf[Buffer].toString(BodyEncoding)

  def fromTransaction(tx: Transaction): Either[Throwable, LedgerTransaction] = {
    val buffer = Buffer.from(tx.body, BodyEncoding)
    Either
      .catchNonFatal(LedgerTransaction.deserialize(buffer))
      .leftMap(InvalidSerializedTransaction.apply)
  }

  def toHash(txHash: LedgerTransactionHash): Hash[Transaction] =
    Hash[Transaction](txHash.serialize().asInstanceOf[Buffer].toString(HashEncoding))

  def toTransaction(tx: LedgerTransaction): Transaction =
    Transaction(
      Header(toHash(tx.transactionHash())),
      tx.serialize().asInstanceOf[Buffer].toString(BodyEncoding),
    )

  abstract class Error(cause: Throwable) extends Exception(cause)
  object Error {
    final case class InvalidInitialState(cause: Throwable) extends Error(cause)
    final case class InvalidSerializedTransaction(cause: Throwable) extends Error(cause)
  }
}
