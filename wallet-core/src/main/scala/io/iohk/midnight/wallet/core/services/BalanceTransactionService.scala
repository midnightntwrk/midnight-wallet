package io.iohk.midnight.wallet.core.services

import cats.data.NonEmptyList
import cats.effect.kernel.Sync
import cats.syntax.all.*
import cats.{Applicative, MonadThrow}
import io.iohk.midnight.js.interop.cats.Instances.{bigIntSumMonoid as sum, *}
import io.iohk.midnight.wallet.core.WalletState
import scala.annotation.tailrec
import scala.scalajs.js
import typings.midnightLedger.mod.*

trait BalanceTransactionService[F[_]] {
  def balanceTransaction(transaction: Transaction): F[(Transaction, ZSwapLocalState)]
}

object BalanceTransactionService {
  @SuppressWarnings(Array("org.wartremover.warts.Equals"))
  class Live[F[_]: Sync](walletState: WalletState[F]) extends BalanceTransactionService[F] {
    private val Buffer = js.BigInt(1000)
    override def balanceTransaction(tx: Transaction): F[(Transaction, ZSwapLocalState)] = {
      walletState.localState().flatMap { state =>
        tx.imbalances()
          // equals is probably checking the reference which is different in the runtime for the native tokens created in different places
          // temporal assumption that we have only native tokens
          // .filter(_.tokenType.equals(nativeToken()))
          .filter(_.imbalance < js.BigInt(0))
          .headOption
          .fold(Applicative[F].pure((tx, state)))(_ => {
            Sync[F].defer {
              tryBalanceTx(state.coins.toList, List.empty, state, tx) match {
                case Left(error)  => MonadThrow[F].raiseError[(Transaction, ZSwapLocalState)](error)
                case Right(value) => Applicative[F].pure(value)
              }
            }
          })
      }
    }

    @tailrec
    private def tryBalanceTx(
        coinsToUse: List[CoinInfo],
        usedCoins: List[CoinInfo],
        state: ZSwapLocalState,
        originalTx: Transaction,
    ): Either[Error, (Transaction, ZSwapLocalState)] = {
      coinsToUse match {
        case coin :: restOfCoins => {
          val coinsForAttempt = coin :: usedCoins
          val balancingTx =
            prepareBalancingTransaction(NonEmptyList.fromListUnsafe(coinsForAttempt), state)
          val change = calculateChange(originalTx, balancingTx)
          if (change > js.BigInt(0)) {
            val (balancingTxWithChange, updatedState) =
              prepareTxWithChange(coinsForAttempt, state, change)
            tryMerge(originalTx, balancingTxWithChange).map((_, updatedState))
          } else if (change == js.BigInt(0)) {
            tryMerge(originalTx, balancingTx).map((_, state))
          } else tryBalanceTx(restOfCoins, coinsForAttempt, state, originalTx)
        }
        case Nil => Left(NotSufficientFunds)
      }
    }

    private def tryMerge(tx1: Transaction, tx2: Transaction): Either[MergeError, Transaction] =
      Option(tx1.merge(tx2).merge[Transaction]).toRight(MergeError(tx1, tx2))

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
        case (None, None)                       => js.BigInt(0)
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
      val txBuilderWithOffer = txBuilder.addOffer(offer, randomness).merge[TransactionBuilder]
      txBuilderWithOffer.intoTransaction().transaction
    }

    private def prepareTxWithChange(
        coins: Seq[CoinInfo],
        state: ZSwapLocalState,
        change: js.BigInt,
    ): (Transaction, ZSwapLocalState) = {
      val coinBalance = coins.map(_.value).combineAll(sum)
      val inputsWithRandomness = coins.map(state.spend)
      val coinOut = new CoinInfo(change, nativeToken())
      val updatedState = state.watchFor(coinOut)
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
      val txBuilderWithOffer = txBuilder.addOffer(offer, randomness).merge[TransactionBuilder]
      (txBuilderWithOffer.intoTransaction().transaction, updatedState)
    }
  }

  sealed abstract class Error(message: String) extends Throwable(message)

  final case object NotSufficientFunds
      extends Error("Not sufficient funds to balance the cost of transaction")
  @SuppressWarnings(Array("org.wartremover.warts.ToString"))
  final case class MergeError(tx1: Transaction, tx2: Transaction)
      extends Error(s"Merging ${tx1.toString()} and ${tx2.toString()}")
}
