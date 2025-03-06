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
    LocalStateNoKeys,
    SecretKeys,
    Transaction,
    Offer,
    QualifiedCoinInfo,
    CoinPubKey,
    EncPubKey,
    CoinInfo,
](using
    zswap.Transaction.HasImbalances[Transaction, TokenType],
    zswap.Transaction.Transaction[Transaction, Offer],
    zswap.LocalStateNoKeys.HasCoins[
      LocalStateNoKeys,
      SecretKeys,
      QualifiedCoinInfo,
      CoinInfo,
      UnprovenInput,
    ],
    zswap.SecretKeys.HasCoinPublicKey[SecretKeys, CoinPubKey],
    zswap.SecretKeys.HasEncryptionPublicKey[SecretKeys, EncPubKey],
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
    case BalancedTransactionAndState(unprovenTx: UnprovenTransaction, state: LocalStateNoKeys)
    case ReadyTransactionAndState(tx: Transaction, state: LocalStateNoKeys)
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
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      tx: Transaction,
  ): Either[Error, BalanceTransactionResult] = {
    val guaranteedImbalances = tx.imbalances(true, tx.fees)
    val nativeTokenGuaranteedImbalance = guaranteedImbalances.getOrElse(nativeTokenType, Zero)
    val guaranteedImbalancesWithoutNativeToken = guaranteedImbalances.removed(nativeTokenType)
    val fallibleImbalances = tx.imbalances(false)

    for {
      guaranteedOfferAndState <- tryBalanceImbalances(
        guaranteedImbalancesWithoutNativeToken,
        state,
        secretKeys,
      )
      (guaranteedOfferContainer, guaranteedState) = guaranteedOfferAndState
      fallibleOfferAndState <- tryBalanceImbalances(fallibleImbalances, guaranteedState, secretKeys)
      (fallibleOfferContainer, fallibleState) = fallibleOfferAndState
      fee = calculateFee(guaranteedOfferContainer) + calculateFee(fallibleOfferContainer)
      nativeTokenOfferAndState <- tryBalanceImbalances(
        Map(nativeTokenType -> (nativeTokenGuaranteedImbalance - fee)),
        fallibleState,
        secretKeys,
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
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      offer: UnprovenOffer,
  ): Either[Error, (UnprovenOffer, LocalStateNoKeys)] = {
    if (isOfferBalanced(offer)) Right((offer, state))
    else {
      val imbalances = offer.deltas
      val nativeTokenImbalance = imbalances.getOrElse(nativeTokenType, Zero)
      val imbalancesWithoutNativeToken = imbalances.removed(nativeTokenType)

      for {
        offerAndState <- tryBalanceImbalances(imbalancesWithoutNativeToken, state, secretKeys)
        (offerContainer, offerState) = offerAndState
        fee = calculateFee(offerContainer)

        nativeTokenOfferAndState <- tryBalanceImbalances(
          Map(
            nativeTokenType -> (nativeTokenImbalance - fee),
          ),
          offerState,
          secretKeys,
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
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
  ): Either[Error, (OfferContainer, LocalStateNoKeys)] = {
    if (isBalanced(imbalances)) {
      Right((OfferContainer(), state))
    } else {
      balanceImbalances(imbalances, state, secretKeys)
    }
  }

  private def isBalanced(imbalances: Map[TokenType, BigInt]): Boolean = {
    imbalances.forall(_._2 >= Zero)
  }

  private def getAvailableCoins(state: LocalStateNoKeys): List[QualifiedCoinInfo] =
    state.availableCoins.sortWith((a, b) => a.value < b.value)

  private def balanceImbalances(
      imbalances: Map[TokenType, BigInt],
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
  ): Either[Error, (OfferContainer, LocalStateNoKeys)] = {
    val tokensToBalance = imbalances.toList.filter(_._2 < Zero)
    val availableCoins = getAvailableCoins(state)

    tokensToBalance.foldLeft(
      Right((OfferContainer(), state)): Either[Error, (OfferContainer, LocalStateNoKeys)],
    ) { case (acc, (tokenType, tokenAmount)) =>
      acc.flatMap { case (offer, state) =>
        balanceToken(
          tokenType,
          -tokenAmount,
          availableCoins.filter(_.tokenType === tokenType),
          state,
          secretKeys,
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
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      accOffer: OfferContainer,
  ): Either[Error, (OfferContainer, LocalStateNoKeys)] = {
    coinsToUse match {
      case coin :: restOfCoins =>
        val fee =
          if (tokenType === nativeTokenType) tt.inputFeeOverhead
          else BigInt(0)
        val unbalancedValue = tokenValue + fee - coin.value
        if (unbalancedValue > Zero) {
          val (offer, newState) = prepareOfferWithInput(state, secretKeys, coin)
          balanceToken(
            tokenType,
            unbalancedValue,
            restOfCoins,
            newState,
            secretKeys,
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
              val (offer, newState) = prepareOfferWithInput(state, secretKeys, coin)
              balanceToken(
                tokenType,
                unbalancedValue,
                restOfCoins,
                newState,
                secretKeys,
                accOffer.mergeOffer(offer),
              )
            } else {
              Right(finalizeOfferWithChange(accOffer, state, secretKeys, coin, change))
            }
          } else {
            Right(finalizeOfferWithChange(accOffer, state, secretKeys, coin, unbalancedValue))
          }
        }
      case Nil => Left(NotSufficientFunds(tokenType))
    }
  }

  private def finalizeOfferWithChange(
      accOffer: OfferContainer,
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      inputCoin: QualifiedCoinInfo,
      change: BigInt,
  ): (OfferContainer, LocalStateNoKeys) = {
    val (offerWithInput, stateWithInput) = prepareOfferWithInput(state, secretKeys, inputCoin)
    // change
    val (offerWithChange, stateWithChange) =
      prepareChangeOffer(stateWithInput, secretKeys, inputCoin.tokenType, change)
    (accOffer.mergeOffer(offerWithInput).mergeOffer(offerWithChange), stateWithChange)
  }

  private def prepareChangeOffer(
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      tokenType: TokenType,
      change: BigInt,
  ): (UnprovenOffer, LocalStateNoKeys) = {
    val changeCoin = ci.create(tokenType, -change)
    val output = uOut.create(changeCoin, secretKeys.coinPublicKey, secretKeys.encryptionPublicKey)
    val offerWithChange =
      uo.fromOutput(output, changeCoin.tokenType, changeCoin.value)
    val stateWithChange = state.watchFor(secretKeys, changeCoin)
    (offerWithChange, stateWithChange)
  }

  private def prepareOfferWithInput(
      state: LocalStateNoKeys,
      secretKeys: SecretKeys,
      coinToSpend: QualifiedCoinInfo,
  ): (UnprovenOffer, LocalStateNoKeys) = {
    val coinSpent = state.spend(secretKeys, coinToSpend)
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
