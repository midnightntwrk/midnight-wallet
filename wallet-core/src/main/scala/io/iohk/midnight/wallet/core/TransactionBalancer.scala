package io.iohk.midnight.wallet.core

import cats.Eq
import cats.syntax.all.*
import scala.annotation.tailrec
import io.iohk.midnight.wallet.zswap

class TransactionBalancer[
    TokenType,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenInput,
    UnprovenOutput,
    LocalState,
    Transaction,
    Offer,
    QualifiedCoinInfo,
    CoinPubKey,
    EncPubKey,
    CoinInfo,
](using
    zswap.Transaction.HasImbalances[Transaction, TokenType],
    zswap.Transaction.Transaction[Transaction, Offer],
    zswap.LocalState.HasCoins[LocalState, QualifiedCoinInfo, CoinInfo, UnprovenInput],
    zswap.LocalState.HasKeys[LocalState, CoinPubKey, EncPubKey, ?],
    zswap.QualifiedCoinInfo[QualifiedCoinInfo, TokenType, ?],
    Eq[TokenType],
)(using
    ci: zswap.CoinInfo[CoinInfo, TokenType],
    tt: zswap.TokenType[TokenType, ?],
    ut: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    uo: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
    uOut: zswap.UnprovenOutput[UnprovenOutput, CoinInfo, CoinPubKey, EncPubKey],
) {
  private val Zero = BigInt(0)
  private val nativeTokenType = tt.native

  enum BalanceTransactionResult {
    case BalancedTransactionAndState(unprovenTx: UnprovenTransaction, state: LocalState)
    case ReadyTransactionAndState(tx: Transaction, state: LocalState)
  }

  case class OfferContainer(offer: Option[UnprovenOffer] = None) {
    def mergeOffer(other: UnprovenOffer): OfferContainer = {
      offer match
        case Some(value) => OfferContainer(Some(value.merge(other)))
        case None        => OfferContainer(Some(other))
    }

    def merge(other: OfferContainer): OfferContainer = {
      other.offer match
        case Some(value) => this.mergeOffer(value)
        case None        => this
    }
    def inputsLength: Int = offer.map(_.inputs.length).getOrElse(0)
    def outputsLength: Int = offer.map(_.outputs.length).getOrElse(0)
  }
  def balanceTransaction(
      state: LocalState,
      tx: Transaction,
  ): Either[Error, BalanceTransactionResult] = {
    val guaranteedImbalances = tx.imbalances(true, tx.fees)
    val nativeTokenGuaranteedImbalance = guaranteedImbalances.getOrElse(nativeTokenType, Zero)
    val guaranteedImbalancesWithoutNativeToken = guaranteedImbalances.removed(nativeTokenType)
    val fallibleImbalances = tx.imbalances(false)

    for {
      guaranteedOfferAndState <- tryBalanceImbalances(guaranteedImbalancesWithoutNativeToken, state)
      (guaranteedOfferContainer, guaranteedState) = guaranteedOfferAndState
      fallibleOfferAndState <- tryBalanceImbalances(fallibleImbalances, guaranteedState)
      (fallibleOfferContainer, fallibleState) = fallibleOfferAndState
      fee = calculateFee(guaranteedOfferContainer) + calculateFee(fallibleOfferContainer)
      nativeTokenOfferAndState <- tryBalanceImbalances(
        Map(nativeTokenType -> (nativeTokenGuaranteedImbalance - fee)),
        fallibleState,
      )
      (nativeTokenOfferContainer, finalState) = nativeTokenOfferAndState
    } yield {
      guaranteedOfferContainer.merge(nativeTokenOfferContainer).offer match
        case Some(guaranteedOffer) =>
          fallibleOfferContainer.offer match
            case Some(fallibleOffer) =>
              BalanceTransactionResult.BalancedTransactionAndState(
                ut.create(guaranteedOffer, fallibleOffer),
                finalState,
              )
            case None =>
              BalanceTransactionResult.BalancedTransactionAndState(
                ut.create(guaranteedOffer),
                finalState,
              )
        case None => BalanceTransactionResult.ReadyTransactionAndState(tx, state)
    }
  }

  def balanceOffer(
      state: LocalState,
      offer: UnprovenOffer,
  ): Either[Error, (UnprovenOffer, LocalState)] = {
    if (isOfferBalanced(offer)) Right((offer, state))
    else {
      val imbalances = offer.deltas
      val nativeTokenImbalance = imbalances.getOrElse(nativeTokenType, Zero)
      val imbalancesWithoutNativeToken = imbalances.removed(nativeTokenType)

      for {
        offerAndState <- tryBalanceImbalances(imbalancesWithoutNativeToken, state)
        (offerContainer, offerState) = offerAndState
        fee = calculateFee(offerContainer)

        nativeTokenOfferAndState <- tryBalanceImbalances(
          Map(
            nativeTokenType -> (nativeTokenImbalance - fee),
          ),
          offerState,
        )
        (nativeTokenOfferContainer, finalState) = nativeTokenOfferAndState
      } yield {
        offerContainer.merge(nativeTokenOfferContainer).offer match
          case Some(newOffer) => (offer.merge(newOffer), finalState)
          case None           => (offer, state)
      }
    }
  }

  private def isOfferBalanced(unprovenOffer: UnprovenOffer): Boolean = {
    val fee = calculateFee(OfferContainer(Some(unprovenOffer)))
    val deltasMap = unprovenOffer.deltas.toMap
    deltasMap.get(nativeTokenType).exists(_ >= fee) && deltasMap.forall(_._2 > Zero)
  }

  private def tryBalanceImbalances(
      imbalances: Map[TokenType, BigInt],
      state: LocalState,
  ): Either[Error, (OfferContainer, LocalState)] = {
    if (isBalanced(imbalances)) {
      Right((OfferContainer(), state))
    } else {
      balanceImbalances(imbalances, state)
    }
  }

  private def isBalanced(imbalances: Map[TokenType, BigInt]): Boolean = {
    imbalances.forall(_._2 >= Zero)
  }

  private def getAvailableCoins(state: LocalState): List[QualifiedCoinInfo] =
    state.availableCoins.sortWith((a, b) => a.value < b.value)

  private def balanceImbalances(
      imbalances: Map[TokenType, BigInt],
      state: LocalState,
  ): Either[Error, (OfferContainer, LocalState)] = {
    val tokensToBalance = imbalances.toList.filter(_._2 < Zero)
    val availableCoins = getAvailableCoins(state)

    tokensToBalance.foldLeft(
      Right((OfferContainer(), state)): Either[Error, (OfferContainer, LocalState)],
    ) { case (acc, (tokenType, tokenAmount)) =>
      acc.flatMap { case (offer, state) =>
        balanceToken(
          tokenType,
          -tokenAmount,
          availableCoins.filter(_.tokenType === tokenType),
          state,
          offer,
        )
      }
    }
  }

  @tailrec
  private def balanceToken(
      tokenType: TokenType,
      tokenValue: BigInt,
      coinsToUse: List[QualifiedCoinInfo],
      state: LocalState,
      accOffer: OfferContainer,
  ): Either[Error, (OfferContainer, LocalState)] = {
    coinsToUse match {
      case coin :: restOfCoins =>
        val fee =
          if (tokenType === nativeTokenType) tt.inputFeeOverhead
          else BigInt(0)
        val unbalancedValue = tokenValue + fee - coin.value
        if (unbalancedValue > Zero) {
          val (offer, newState) = prepareOfferWithInput(state, coin)
          balanceToken(
            tokenType,
            unbalancedValue,
            restOfCoins,
            newState,
            accOffer.mergeOffer(offer),
          )
        } else {
          if (tokenType === nativeTokenType) {
            val change = unbalancedValue + tt.outputFeeOverhead
            if (change >= Zero) {
              // The change amount is smaller than output fee, so we need to add another input
              // in order to create a larger change output to avoid generating dust
              // (i.e. an output with value smaller than the cost of adding it to a transaction,
              // not to confuse with Midnight's native token)
              val (offer, newState) = prepareOfferWithInput(state, coin)
              balanceToken(
                tokenType,
                unbalancedValue,
                restOfCoins,
                newState,
                accOffer.mergeOffer(offer),
              )
            } else {
              Right(finalizeOfferWithChange(accOffer, state, coin, change))
            }
          } else {
            Right(finalizeOfferWithChange(accOffer, state, coin, unbalancedValue))
          }
        }
      case Nil => Left(NotSufficientFunds(tokenType))
    }
  }

  private def finalizeOfferWithChange(
      accOffer: OfferContainer,
      state: LocalState,
      inputCoin: QualifiedCoinInfo,
      change: BigInt,
  ): (OfferContainer, LocalState) = {
    val (offerWithInput, stateWithInput) = prepareOfferWithInput(state, inputCoin)
    // change
    val (offerWithChange, stateWithChange) =
      prepareChangeOffer(stateWithInput, inputCoin.tokenType, change)
    (accOffer.mergeOffer(offerWithInput).mergeOffer(offerWithChange), stateWithChange)
  }

  private def prepareChangeOffer(
      state: LocalState,
      tokenType: TokenType,
      change: BigInt,
  ): (UnprovenOffer, LocalState) = {
    val changeCoin = ci.create(tokenType, -change)
    val output = uOut.create(changeCoin, state.coinPublicKey, state.encryptionPublicKey)
    val offerWithChange =
      uo.fromOutput(output, changeCoin.tokenType, changeCoin.value)
    val stateWithChange = state.watchFor(changeCoin)
    (offerWithChange, stateWithChange)
  }

  private def prepareOfferWithInput(
      state: LocalState,
      coinToSpend: QualifiedCoinInfo,
  ): (UnprovenOffer, LocalState) = {
    val coinSpent = state.spend(coinToSpend)
    val newState = coinSpent._1
    val input = coinSpent._2
    val offer = uo.fromInput(input, coinToSpend.tokenType, coinToSpend.value)
    (offer, newState)
  }

  private def calculateFee(offer: OfferContainer): BigInt = {
    val inputsFee = tt.inputFeeOverhead * BigInt(offer.inputsLength)
    val outputsFee = tt.outputFeeOverhead * BigInt(offer.outputsLength)

    // this needs to be revised post public devnet launch
    val overheadFee = tt.inputFeeOverhead + (2 * tt.outputFeeOverhead)

    inputsFee + outputsFee + overheadFee
  }

  sealed abstract class Error(message: String) extends Throwable(message)

  // TODO: add "needed" and "available" information
  case class NotSufficientFunds(tokenType: TokenType)
      extends Error(s"Not sufficient funds to balance token: $tokenType")
}
