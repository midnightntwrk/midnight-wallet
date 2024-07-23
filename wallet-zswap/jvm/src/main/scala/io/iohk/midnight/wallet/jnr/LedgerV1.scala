package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import scala.util.Try

trait LedgerV1 {

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

object LedgerV1 {
  val instance: Try[LedgerV1] =
    LedgerLoader.loadLedger(networkId = None, ProtocolVersion.V1)

  def instanceWithNetworkId(networkId: NetworkId): Try[LedgerV1] =
    LedgerLoader.loadLedger(Some(networkId), ProtocolVersion.V1)
}
