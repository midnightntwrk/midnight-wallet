package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import scala.annotation.tailrec
import io.iohk.midnight.wallet.zswap.*

@SuppressWarnings(Array("org.wartremover.warts.Equals"))
object TransactionBalancer {
  private val Zero = BigInt(0)
  private val nativeTokenType = TokenType.Native

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
                UnprovenTransaction(guaranteedOffer, fallibleOffer),
                finalState,
              )
            case None =>
              BalanceTransactionResult.BalancedTransactionAndState(
                UnprovenTransaction(guaranteedOffer),
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
        nativeTokenOfferAndState <- tryBalanceImbalances(
          Map(nativeTokenType -> (nativeTokenImbalance - calculateFee(offerContainer))),
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

  private def getAvailableCoins(state: LocalState): List[QualifiedCoinInfo] = {
    state.coins
      .filterNot(coin => state.pendingSpends.exists(_.nonce === coin.nonce))
      .sortWith((a, b) => a.value < b.value)
  }

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
        val unbalancedValue = ifNativeTokenOrElse(tokenType)(
          tokenValue + TokenType.InputFeeOverhead - coin.value,
        )(tokenValue - coin.value)
        if (unbalancedValue > Zero) {
          val (offer, newState) = prepareOfferWithInput(state, coin)
          balanceToken(
            tokenType,
            unbalancedValue,
            restOfCoins,
            newState,
            accOffer.mergeOffer(offer),
          )
        } else if (unbalancedValue == Zero) {
          val (offer, newState) = prepareOfferWithInput(state, coin)
          Right((accOffer.mergeOffer(offer), newState))
        } else {
          ifNativeTokenOrElse(tokenType) {
            val change = unbalancedValue + TokenType.OutputFeeOverhead
            if (change >= Zero) {
              // change amount is smaller than output fee, so there is no need to create output with change
              val (offer, newState) = prepareOfferWithInput(state, coin)
              Right((accOffer.mergeOffer(offer), newState))
            } else {
              Right(finalizeOfferWithChange(accOffer, state, coin, change))
            }
          }(Right(finalizeOfferWithChange(accOffer, state, coin, unbalancedValue)))
        }
      case Nil => Left(NotSufficientFunds(tokenType))
    }
  }

  private def ifNativeTokenOrElse[T](tokenType: TokenType)(ifNativeToken: => T)(orElse: => T): T = {
    if (tokenType === nativeTokenType) {
      ifNativeToken
    } else {
      orElse
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
    val changeCoin = CoinInfo(tokenType, -change)
    val output = UnprovenOutput(changeCoin, state.coinPublicKey, state.encryptionPublicKey)
    val offerWithChange =
      UnprovenOffer.fromOutput(output, changeCoin.tokenType, changeCoin.value)
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
    val offer = UnprovenOffer.fromInput(input, coinToSpend.tokenType, coinToSpend.value)
    (offer, newState)
  }

  private def calculateFee(offer: OfferContainer): BigInt = {
    val inputsFee = TokenType.InputFeeOverhead * BigInt(offer.inputsLength)
    val outputsFee = TokenType.OutputFeeOverhead * BigInt(offer.outputsLength)
    inputsFee + outputsFee
  }

  sealed abstract class Error(message: String) extends Throwable(message)

  // TODO: add "needed" and "available" information
  case class NotSufficientFunds(tokenType: TokenType)
      extends Error(s"Not sufficient funds to balance token: $tokenType")
}
