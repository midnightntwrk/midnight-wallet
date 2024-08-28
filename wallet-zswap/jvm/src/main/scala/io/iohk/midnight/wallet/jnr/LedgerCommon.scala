package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList

trait LedgerCommon {
  def tryDeserializeEncryptionKey(
      encryptionKeySerialized: String,
  ): Either[NonEmptyList[JNRError], StringResult]

  def isTransactionRelevant(
      tx: String,
      encryptionKeySerialized: String,
  ): Either[NonEmptyList[JNRError], BooleanResult]

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
