package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import io.iohk.midnight.wallet.jnr.Ledger.{BooleanResult, JNRError, NumberResult, StringResult}
import io.iohk.midnight.wallet.jnr.LedgerSuccess.OperationTrue
import jnr.ffi.Pointer

import scala.util.Try

trait Ledger {

  def tryDeserializeEncryptionKey(
      encryptionKeySerialized: String,
  ): Either[NonEmptyList[JNRError], StringResult]

  def isTransactionRelevant(
      tx: String,
      encryptionKeySerialized: String,
  ): Either[NonEmptyList[JNRError], BooleanResult]

  def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[NonEmptyList[JNRError], StringResult]

  def extractGuaranteedCoinsFromTransaction(
      tx: String,
  ): Either[NonEmptyList[JNRError], StringResult]

  def extractFallibleCoinsFromTransaction(
      tx: String,
  ): Either[NonEmptyList[JNRError], Option[String]]

  def zswapChainStateNew(): Either[NonEmptyList[JNRError], StringResult]

  def zswapChainStateFirstFree(
      zswapChainState: String,
  ): Either[NonEmptyList[JNRError], NumberResult]

  def zswapChainStateFilter(
      zswapChainState: String,
      contractAddress: String,
  ): Either[NonEmptyList[JNRError], StringResult]

  def zswapChainStateTryApply(
      zswapChainState: String,
      offer: String,
  ): Either[NonEmptyList[JNRError], StringResult]

  def zswapChainStateMerkleTreeRoot(
      zswapChainStatesSerialized: String,
  ): Either[NonEmptyList[JNRError], StringResult]

  def merkleTreeCollapsedUpdateNew(
      zswapChainState: String,
      indexStart: Long,
      indexEnd: Long,
  ): Either[NonEmptyList[JNRError], StringResult]
}

object Ledger {

  private val LEDGER_RESULT_STRUCT_OFFSET = 0
  private val LEDGER_RESULT_FIELD_SIZE = 8 // In Rust ApplyResult::ledger_result is i16 (2 bytes)

  val instance: Try[Ledger] =
    LedgerLoader.loadLedger(networkId = None)

  def instanceWithNetworkId(networkId: NetworkId): Try[Ledger] =
    LedgerLoader.loadLedger(Some(networkId))

  sealed trait JNRResult

  sealed trait JNRSuccessCallResult extends JNRResult

  sealed trait JNRError extends JNRResult {
    def getMessage: String
  }
  final case class LedgerErrorResult(ledgerResult: LedgerResult) extends JNRError {
    override def getMessage: String = s"Ledger error code ${ledgerResult.code}"
  }
  final case class UnexpectedJNRError(throwable: Throwable) extends JNRError {
    override def getMessage: String = throwable.getMessage
  }

  final case class NumberResult(data: Long) extends JNRSuccessCallResult

  object NumberResult {

    def applyEither(pointer: Pointer): Either[JNRError, NumberResult] = {
      val ledgerResult = LedgerResult(pointer.getShort(LEDGER_RESULT_STRUCT_OFFSET))

      ledgerResult match {
        case LedgerSuccess.OperationTrue =>
          val numberData = pointer.getLong(LEDGER_RESULT_FIELD_SIZE)
          Right(NumberResult(numberData))
        case error: LedgerError =>
          Left(LedgerErrorResult(error))
        case unexpected =>
          Left(LedgerErrorResult(unexpected))
      }
    }
  }

  final case class StringResult(data: String) extends JNRSuccessCallResult {
    def optionalData: Option[String] = Option.when(data.nonEmpty)(data)
  }

  object StringResult {

    def applyEither(pointer: Pointer): Either[JNRError, StringResult] = {
      val ledgerResult = LedgerResult(pointer.getShort(LEDGER_RESULT_STRUCT_OFFSET))

      ledgerResult match {
        case LedgerSuccess.OperationTrue =>
          val stringData = pointer
            .getPointer(LEDGER_RESULT_FIELD_SIZE)
            .getString(0)
          Right(StringResult(stringData))

        case error: LedgerError =>
          Left(LedgerErrorResult(error))
        case unexpected =>
          Left(LedgerErrorResult(unexpected))
      }
    }
  }

  final case class BooleanResult(booleanData: Boolean) extends JNRSuccessCallResult

  object BooleanResult {

    def applyEither(result: Int): Either[JNRError, BooleanResult] = {
      LedgerResult(result) match {
        case LedgerSuccess.OperationTrue =>
          Right(BooleanResult(true))
        case LedgerSuccess.OperationFalse =>
          Right(BooleanResult(false))
        case error: LedgerError =>
          Left(LedgerErrorResult(error))
        case unexpected =>
          Left(LedgerErrorResult(unexpected))
      }
    }
  }
}
