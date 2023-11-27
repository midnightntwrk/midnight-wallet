package io.iohk.midnight.wallet.core

import cats.data.NonEmptyList
import cats.syntax.eq.*
import io.iohk.midnight.wallet.zswap.*
import io.iohk.midnight.wallet.core.Generators.{OfferWithContext, unprovenOfferWithContextArbitrary}
import io.iohk.midnight.wallet.core.TransactionBalancer.NotSufficientFunds
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import munit.ScalaCheckSuite
import org.scalacheck.Prop.forAll
import org.scalacheck.{Gen, Test}

@SuppressWarnings(Array("org.wartremover.warts.Equals"))
class TransactionBalancerOfferSpec extends ScalaCheckSuite with BetterOutputSuite {

  override def scalaCheckTestParameters: Test.Parameters =
    super.scalaCheckTestParameters.withMinSuccessfulTests(10)

  private def generateOfferData: Gen[(LocalState, UnprovenOffer, NonEmptyList[CoinInfo])] = {
    unprovenOfferWithContextArbitrary.arbitrary.map { offerWithContext =>
      val unprovenOffer = offerWithContext.offer
      // generating reasonable amount of native coins for fees
      val nativeTokenAmount =
        (TokenType.Native, TokenType.InputFeeOverhead * TokenType.OutputFeeOverhead)
      // generating reasonable amount of coins
      val imbalances = nativeTokenAmount :: offerWithContext.coinOutputs.map(coin =>
        (coin.tokenType, coin.value * coin.value),
      )
      val coins = Generators.generateCoinsFor(imbalances)
      val stateWithCoins = Generators.generateStateWithCoins(coins)
      (stateWithCoins, unprovenOffer, coins)
    }
  }

  test("balance offer") {
    forAll(generateOfferData) { data =>
      val (stateWithCoins, imbalancedOffer, coins) = data
      TransactionBalancer
        .balanceOffer(stateWithCoins, imbalancedOffer) match {
        case Left(error) => fail(error.getMessage, error)
        case Right((balancedOffer, newState)) =>
          assert(balancedOffer.deltas.toList.forall(_._2 > BigInt(0)))
          assert(balancedOffer.outputs.length >= imbalancedOffer.outputs.length)
          assert(balancedOffer.inputs.nonEmpty)
          assert(newState.pendingOutputsSize > 0)
      }
    }
  }

  test("no offer changes when offer has positive imbalances") {
    forAll(generateOfferData) { data =>
      val (stateWithCoins, imbalancedOffer, _) = data

      TransactionBalancer
        .balanceOffer(stateWithCoins, imbalancedOffer)
        .flatMap { case (balancedOffer, _) =>
          TransactionBalancer.balanceOffer(stateWithCoins, balancedOffer).map {
            case (doubleBalancedOffer, _) =>
              (balancedOffer, doubleBalancedOffer)
          }
        } match {
        case Left(error) => fail(error.getMessage, error)
        case Right((balancedOffer, doubleBalancedOffer)) =>
          val balancedDeltas = balancedOffer.deltas.toList
          val doubleBalancedDeltas = doubleBalancedOffer.deltas.toList
          val sameElements = balancedDeltas.forall(value =>
            doubleBalancedDeltas.exists(el => el._1 === value._1 && el._2 === value._2),
          )
          assert(sameElements)
          assert(balancedDeltas.lengthIs.==(doubleBalancedDeltas.length))
      }
    }
  }

  test("fails when not enough funds to balance offer cost") {
    forAll { (offerWithContext: OfferWithContext) =>
      val imbalancedOffer = offerWithContext.offer
      val imbalances = offerWithContext.coinOutputs.map(coin => (coin.tokenType, coin.value))
      val possibleTokenTypes = imbalances.map(_._1).prepend(TokenType.Native)
      // generating not enough coins
      val stateWithCoins = Generators.generateStateWithFunds(imbalances)

      TransactionBalancer
        .balanceOffer(stateWithCoins, imbalancedOffer) match {
        case Left(NotSufficientFunds(tokenType)) =>
          assert(possibleTokenTypes.exists(_ === tokenType))
        case _ =>
          fail("Balancing transaction process should fail because of not sufficient funds")
      }
    }
  }

  test("fails when not enough funds to balance offer cost (all coins are pending spends)") {
    forAll { (offerWithContext: OfferWithContext) =>
      val imbalancedOffer = offerWithContext.offer
      val stateWithCoins = offerWithContext.state
      val stateCoins = stateWithCoins.coins
      val stateWithSpentCoins = stateCoins.foldLeft(stateWithCoins) { (accState, coin) =>
        accState.spend(coin)._1
      }
      val possibleTokenTypes =
        offerWithContext.coinOutputs.map(_.tokenType).prepend(TokenType.Native)

      TransactionBalancer
        .balanceOffer(stateWithSpentCoins, imbalancedOffer) match {
        case Left(NotSufficientFunds(tokenType)) =>
          assert(possibleTokenTypes.exists(_ === tokenType))
        case _ =>
          fail("Balancing transaction process should fail because of not sufficient funds")
      }
    }
  }
}
