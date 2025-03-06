// package io.iohk.midnight.wallet.core
//
//import cats.data.NonEmptyList
//import cats.syntax.eq.*
//import io.iohk.midnight.midnightNtwrkZswap.mod.*
//import io.iohk.midnight.js.interop.util.BigIntOps.*
//import io.iohk.midnight.js.interop.util.MapOps.*
//import io.iohk.midnight.js.interop.util.SetOps.*
//import io.iohk.midnight.wallet.core.Generators.{OfferWithContext, unprovenOfferWithContextArbitrary}
//import io.iohk.midnight.wallet.core.util.BetterOutputSuite
//import io.iohk.midnight.wallet.zswap.given
//import munit.ScalaCheckSuite
//import org.scalacheck.Prop.forAll
//import org.scalacheck.{Gen, Test}
//
//@SuppressWarnings(Array("org.wartremover.warts.Equals"))
//class TransactionBalancerOfferSpec extends ScalaCheckSuite with BetterOutputSuite {
//
//  override def scalaCheckTestParameters: Test.Parameters =
//    super.scalaCheckTestParameters.withMinSuccessfulTests(10)
//
//  private val transactionBalancer =
//    new TransactionBalancer[
//      TokenType,
//      UnprovenTransaction,
//      UnprovenOffer,
//      UnprovenInput,
//      UnprovenOutput,
//      LocalStateNoKeys,
//      SecretKeys,
//      Transaction,
//      Offer,
//      QualifiedCoinInfo,
//      CoinPublicKey,
//      EncPublicKey,
//      CoinInfo,
//    ]
//
//  private val transactionCostModel =
//    TransactionCostModel.dummyTransactionCostModel()
//  private val inputFeeOverhead =
//    transactionCostModel.inputFeeOverhead.toScalaBigInt
//  private val outputFeeOverhead =
//    transactionCostModel.outputFeeOverhead.toScalaBigInt
//
//  private def generateOfferData: Gen[(LocalStateNoKeys, UnprovenOffer, NonEmptyList[CoinInfo])] = {
//    unprovenOfferWithContextArbitrary.arbitrary.map { offerWithContext =>
//      val unprovenOffer = offerWithContext.offer
//      // generating reasonable amount of native coins for fees
//      val nativeTokenAmount =
//        (nativeToken(), inputFeeOverhead * outputFeeOverhead)
//      // generating reasonable amount of coins
//      val imbalances = nativeTokenAmount :: offerWithContext.coinOutputs.map(coin =>
//        (coin.`type`, coin.value.toScalaBigInt * coin.value.toScalaBigInt),
//      )
//      val coins = Generators.generateCoinsFor(imbalances)
//      val stateWithCoins = Generators.generat eStateWithCoins(coins)
//      (stateWithCoins, unprovenOffer, coins)
//    }
//  }
//
//  test("balance offer") {
//    forAll(generateOfferData) { data =>
//      val (stateWithCoins, imbalancedOffer, coins) = data
//      transactionBalancer
//        .balanceOffer(stateWithCoins, imbalancedOffer) match {
//        case Left(error) => fail(error.getMessage, error)
//        case Right((balancedOffer, newState)) =>
//          assert(balancedOffer.deltas.toList.forall(_._2 > BigInt(0).toJsBigInt))
//          assert(balancedOffer.outputs.length >= imbalancedOffer.outputs.length)
//          assert(balancedOffer.inputs.nonEmpty)
//          assert(newState.pendingOutputs.size > 0)
//      }
//    }
//  }
//
//  test("no offer changes when offer has positive imbalances") {
//    forAll(generateOfferData) { data =>
//      val (stateWithCoins, imbalancedOffer, _) = data
//
//      transactionBalancer
//        .balanceOffer(stateWithCoins, imbalancedOffer)
//        .flatMap { case (balancedOffer, _) =>
//          transactionBalancer.balanceOffer(stateWithCoins, balancedOffer).map {
//            case (doubleBalancedOffer, _) =>
//              (balancedOffer, doubleBalancedOffer)
//          }
//        } match {
//        case Left(error) => fail(error.getMessage, error)
//        case Right((balancedOffer, doubleBalancedOffer)) =>
//          val balancedDeltas = balancedOffer.deltas.toList
//          val doubleBalancedDeltas = doubleBalancedOffer.deltas.toList
//          val sameElements = balancedDeltas.forall { (tokenType, value) =>
//            doubleBalancedDeltas.exists { (deltaTokenType, deltaValue) =>
//              deltaTokenType === tokenType && deltaValue.toScalaBigInt === value.toScalaBigInt
//            }
//          }
//          assert(sameElements)
//          assert(balancedDeltas.lengthIs.==(doubleBalancedDeltas.length))
//      }
//    }
//  }
//
//  test("fails when not enough funds to balance offer cost") {
//    forAll { (offerWithContext: OfferWithContext) =>
//      val imbalancedOffer = offerWithContext.offer
//      val imbalances =
//        offerWithContext.coinOutputs.map(coin => (coin.tokenType, coin.value.toScalaBigInt))
//      val possibleTokenTypes = imbalances.map(_._1).prepend(nativeToken())
//      // generating not enough coins
//      val stateWithCoins = Generators.generateStateWithFunds(imbalances)
//
//      transactionBalancer
//        .balanceOffer(stateWithCoins, imbalancedOffer) match {
//        case Left(transactionBalancer.NotSufficientFunds(tokenType)) =>
//          assert(possibleTokenTypes.exists(_ === tokenType))
//        case _ =>
//          fail("Balancing transaction process should fail because of not sufficient funds")
//      }
//    }
//  }
//
//  test("fails when not enough funds to balance offer cost (all coins are pending spends)") {
//    forAll { (offerWithContext: OfferWithContext) =>
//      val imbalancedOffer = offerWithContext.offer
//      val stateWithCoins = offerWithContext.state
//      val stateCoins = stateWithCoins.coins
//      val stateWithSpentCoins = stateCoins.toList.foldLeft(stateWithCoins) { (accState, coin) =>
//        accState.spend(coin)._1
//      }
//      val possibleTokenTypes =
//        offerWithContext.coinOutputs.map(_.`type`).prepend(nativeToken())
//
//      transactionBalancer
//        .balanceOffer(stateWithSpentCoins, imbalancedOffer) match {
//        case Left(transactionBalancer.NotSufficientFunds(tokenType)) =>
//          assert(possibleTokenTypes.exists(_ === tokenType))
//        case _ =>
//          fail("Balancing transaction process should fail because of not sufficient funds")
//      }
//    }
//  }
//}
