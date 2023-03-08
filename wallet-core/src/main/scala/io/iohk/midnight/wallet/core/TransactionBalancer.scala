package io.iohk.midnight.wallet.core

import cats.data.NonEmptyList
import cats.syntax.all.*
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.midnightLedger.mod.*

import scala.annotation.tailrec
import scala.scalajs.js
@SuppressWarnings(Array("org.wartremover.warts.Equals"))
object TransactionBalancer {
  private val Buffer = js.BigInt(2000)
  private val Zero = js.BigInt(0)
  def balanceTransaction(
      state: ZSwapLocalState,
      tx: Transaction,
  ): Either[Error, (Transaction, ZSwapLocalState)] =
    tx.imbalances()
      .filter(_.tokenType.equals(nativeToken()))
      .filter(_.imbalance < Zero)
      .headOption
      .fold[Either[Error, (Transaction, ZSwapLocalState)]](Right((tx, state)))(_ => {
        tryBalanceTx(state.coins.toList, List.empty, state, tx).map((_, state))
      })

  @tailrec
  private def tryBalanceTx(
      coinsToUse: List[CoinInfo],
      usedCoins: List[CoinInfo],
      state: ZSwapLocalState,
      originalTx: Transaction,
  ): Either[Error, Transaction] =
    coinsToUse match {
      case coin :: restOfCoins =>
        val coinsForAttempt = NonEmptyList.of(coin, usedCoins*)
        val balancingTx =
          prepareBalancingTransaction(coinsForAttempt, state)
        val change = calculateChange(originalTx, balancingTx)
        if (change > Zero) {
          val balancingTxWithChange = prepareTxWithChange(coinsForAttempt.toList, state, change)
          Right(originalTx.merge(balancingTxWithChange))
        } else if (change == Zero) {
          Right(originalTx.merge(balancingTx))
        } else tryBalanceTx(restOfCoins, coinsForAttempt.toList, state, originalTx)
      case Nil => Left(NotSufficientFunds)
    }

  private def getImbalance(tx: Transaction): Option[js.BigInt] = {
    tx.imbalances()
      // equals is probably checking the reference which is different in the runtime for the native tokens created in different places
      // temporal assumption that we have only native tokens
      // .filter(_.tokenType.equals(nativeToken()))
      .headOption
      .map(_.imbalance)
  }

  private def calculateChange(orginalTx: Transaction, balancingTx: Transaction): js.BigInt = {
    val orgTxImbalanceOpt = getImbalance(orginalTx)
    val balancingTxImbalanceOpt = getImbalance(balancingTx)
    (orgTxImbalanceOpt, balancingTxImbalanceOpt) match {
      case (Some(orgTxImbalance), Some(balancingTxImbalance)) =>
        (orgTxImbalance - Buffer) + balancingTxImbalance
      case (Some(orgTxImbalance), None)       => orgTxImbalance - Buffer
      case (None, Some(balancingTxImbalance)) => balancingTxImbalance
      case (None, None)                       => Zero
    }
  }

  private def prepareBalancingTransaction(
      coins: NonEmptyList[CoinInfo],
      state: ZSwapLocalState,
  ): Transaction = {
    val coinBalance = coins.map(_.value).combineAll(sum)
    val inputsWithRandomness = coins.map(state.spend)
    val delta = new ZSwapDeltas()
    delta.insert(nativeToken(), coinBalance)
    val offer = new ZSwapOffer(
      inputs = js.Array(inputsWithRandomness.map(_.input).toList*),
      outputs = js.Array(),
      transient = js.Array(),
      deltas = delta,
    )
    val randomness = inputsWithRandomness
      .map(_.randomness)
      .reduceLeft(_.merge(_))
    val txBuilder = new TransactionBuilder(new LedgerState())
    txBuilder.addOffer(offer, randomness)
    txBuilder.intoTransaction().transaction
  }

  private def prepareTxWithChange(
      coins: Seq[CoinInfo],
      state: ZSwapLocalState,
      change: js.BigInt,
  ): Transaction = {
    val coinBalance = coins.map(_.value).combineAll(sum)
    val inputsWithRandomness = coins.map(state.spend)
    val coinOut = new CoinInfo(change, nativeToken())
    state.watchFor(coinOut)
    val output = ZSwapOutputWithRandomness.`new`(coinOut, state.coinPublicKey)
    val delta = new ZSwapDeltas()
    delta.insert(nativeToken(), coinBalance - change)
    val offer = new ZSwapOffer(
      inputs = js.Array(inputsWithRandomness.map(_.input).toList*),
      outputs = js.Array(output.output),
      transient = js.Array(),
      deltas = delta,
    )
    val randomness = NonEmptyList
      .of(output.randomness, inputsWithRandomness.map(_.randomness)*)
      .reduceLeft(_.merge(_))
    val txBuilder = new TransactionBuilder(new LedgerState())
    txBuilder.addOffer(offer, randomness)
    txBuilder.intoTransaction().transaction
  }

  sealed abstract class Error(message: String) extends Throwable(message)

  final case object NotSufficientFunds
      extends Error("Not sufficient funds to balance the cost of transaction")
}
