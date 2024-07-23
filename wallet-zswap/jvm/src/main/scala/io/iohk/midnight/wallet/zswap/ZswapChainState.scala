package io.iohk.midnight.wallet.zswap

import cats.syntax.all.*
import io.iohk.midnight.wallet.jnr.LedgerV1
import io.iohk.midnight.wallet.jnr.{NumberResult, StringResult}
import scala.util.{Failure, Success, Try}

final case class ZswapChainState(state: String, ledger: LedgerV1) {
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def firstFree: BigInt =
    ledger.zswapChainStateFirstFree(state) match {
      case Right(NumberResult(data)) => BigInt(data)
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
    }
  @SuppressWarnings(Array("org.wartremover.warts.Throw"))
  def tryApply(offer: Offer): ZswapChainState =
    ledger.zswapChainStateTryApply(state, offer.data) match {
      case Right(StringResult(data)) => ZswapChainState(data, ledger)
      case Left(errors) => throw Exception(errors.map(_.getMessage).toList.mkString(", "))
    }
  def serialize: String = state
}

object ZswapChainState {
  def apply(ledger: LedgerV1): Try[ZswapChainState] =
    ledger.zswapChainStateNew() match {
      case Right(StringResult(data)) => Success(ZswapChainState(data, ledger))
      case Left(errors) => Failure(Exception(errors.map(_.getMessage).toList.mkString(", ")))
    }

  def apply(): Try[ZswapChainState] =
    LedgerV1.instance.flatMap(apply)

  def deserialize(state: String, ledger: LedgerV1): ZswapChainState = ZswapChainState(state, ledger)
}
