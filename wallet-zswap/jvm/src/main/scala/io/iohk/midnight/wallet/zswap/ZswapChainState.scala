package io.iohk.midnight.wallet.zswap

import cats.syntax.all.*
import io.iohk.midnight.wallet.jnr.LedgerLoader.AllLedgers
import io.iohk.midnight.wallet.jnr.{NumberResult, StringResult}

import scala.util.{Failure, Success, Try}

final case class ZswapChainState(state: String, allLedgers: AllLedgers) {
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def firstFree: BigInt = {
    allLedgers.zswapChainStateFirstFree(state) match {
      case Right(NumberResult(data)) => BigInt(data)
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
    }
  }

  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def tryApply(offer: Offer): ZswapChainState = {
    allLedgers.zswapChainStateTryApply(state, offer.data) match {
      case Right(StringResult(data)) => ZswapChainState(data, allLedgers)
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
    }
  }

  def serialize: String = state
}

object ZswapChainState {
  def apply(allLedgers: AllLedgers): Try[ZswapChainState] = {
    allLedgers.zswapChainStateNew() match {
      case Right(StringResult(data)) => Success(ZswapChainState(data, allLedgers))
      case Left(errors) => Failure(Exception(errors.map(_.getMessage).toList.mkString(", ")))
    }
  }

  def deserialize(state: String, allLedgers: AllLedgers): ZswapChainState =
    ZswapChainState(state, allLedgers)
}
