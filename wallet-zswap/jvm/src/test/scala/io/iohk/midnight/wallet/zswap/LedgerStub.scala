package io.iohk.midnight.wallet.zswap

import cats.data.NonEmptyList
import cats.syntax.eq.*
import io.iohk.midnight.wallet.jnr.Ledger.{
  JNRError,
  LedgerErrorResult,
  NumberResult,
  StringResult,
  UnexpectedJNRError,
}
import io.iohk.midnight.wallet.jnr.{Ledger, LedgerError, LedgerResult, LedgerSuccess, NetworkId}
import io.iohk.midnight.wallet.zswap.LedgerStub.*

import java.nio.charset.StandardCharsets

class LedgerStub extends Ledger {

  override def setNetworkId(networkId: NetworkId): Either[NonEmptyList[JNRError], NumberResult] =
    Left(NonEmptyList.one(UnexpectedJNRError(UnsupportedOperationException())))

  override def isTransactionRelevant(tx: String, encryptionKeySerialized: String): LedgerResult =
    if (tx === TxRelevant) LedgerSuccess.OperationTrue
    else if (tx === TxNotRelevant) LedgerSuccess.OperationFalse
    else if (tx === TxUnknown) LedgerResult.UnknownCode(1)
    else LedgerError.StateError

  override def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[NonEmptyList[JNRError], StringResult] = {
    if (tx === ValidTx)
      Right(StringResult(AppliedTxState))
    else if (tx === ValidTxNoData)
      Left(NonEmptyList.one(LedgerErrorResult(LedgerError.TransactionError)))
    else
      Left(NonEmptyList.one(UnexpectedJNRError(Exception("fail!"))))
  }

  override def zswapChainStateNew(): Either[NonEmptyList[JNRError], StringResult] =
    Left(NonEmptyList.one(UnexpectedJNRError(UnsupportedOperationException())))

  override def zswapChainStateFirstFree(
      zswapChainState: String,
  ): Either[NonEmptyList[JNRError], NumberResult] =
    Left(NonEmptyList.one(UnexpectedJNRError(UnsupportedOperationException())))

  override def zswapChainStateTryApply(
      zswapChainState: String,
      offer: String,
  ): Either[NonEmptyList[JNRError], StringResult] =
    Left(NonEmptyList.one(UnexpectedJNRError(UnsupportedOperationException())))

  override def merkleTreeCollapsedUpdateNew(
      zswapChainState: String,
      indexStart: Long,
      indexEnd: Long,
  ): Either[NonEmptyList[JNRError], StringResult] =
    Left(NonEmptyList.one(UnexpectedJNRError(UnsupportedOperationException())))

  override def extractGuaranteedCoinsFromTransaction(
      tx: String,
  ): Either[NonEmptyList[JNRError], StringResult] =
    Left(NonEmptyList.one(UnexpectedJNRError(UnsupportedOperationException())))

  override def extractFallibleCoinsFromTransaction(
      tx: String,
  ): Either[NonEmptyList[JNRError], Option[String]] =
    Left(NonEmptyList.one(UnexpectedJNRError(UnsupportedOperationException())))
}

object LedgerStub {
  val TxRelevant = HexUtil.encodeHex("relevant".getBytes(StandardCharsets.UTF_8))
  val TxNotRelevant = HexUtil.encodeHex("not-relevant".getBytes(StandardCharsets.UTF_8))
  val TxUnknown = HexUtil.encodeHex("unknown-code".getBytes(StandardCharsets.UTF_8))

  val ValidTx = HexUtil.encodeHex("test-tx".getBytes(StandardCharsets.UTF_8))
  val ValidTxNoData = HexUtil.encodeHex("test-tx-no-data".getBytes(StandardCharsets.UTF_8))
  val AppliedTxState = HexUtil.encodeHex("well done".getBytes(StandardCharsets.UTF_8))
}
