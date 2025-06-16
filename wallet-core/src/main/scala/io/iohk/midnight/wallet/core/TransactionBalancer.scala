package io.iohk.midnight.wallet.core

import cats.Eq
import cats.syntax.all.*
import scala.scalajs.js
import cats.Show
import scala.scalajs.js.JSConverters.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.midnightNtwrkWalletSdkCapabilities.mod.{
  getBalanceRecipe,
  TransactionCostModel,
  Imbalances,
}

class TransactionBalancer[
    LocalState,
    TokenType,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenInput,
    UnprovenOutput,
    Transaction,
    Offer,
    QualifiedCoinInfo,
    CoinInfo,
](using
    zswap.Transaction.HasImbalances[Transaction, TokenType],
    zswap.Transaction.Transaction[Transaction, Offer],
    zswap.QualifiedCoinInfo[QualifiedCoinInfo, TokenType, ?],
    zswap.Offer[Offer, TokenType],
    Eq[TokenType],
    Show[TokenType],
)(using
    coinInfo: zswap.CoinInfo[CoinInfo, TokenType],
    qualifiedCoinInfo: zswap.QualifiedCoinInfo[QualifiedCoinInfo, TokenType, ?],
    tokenType: zswap.TokenType[TokenType, ?],
    unprovenTx: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    unprovenOffer: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
) {
  enum BalanceTransactionResult {
    case BalancedTransactionAndState(unprovenTx: UnprovenTransaction, state: LocalState)
    case ReadyTransactionAndState(tx: Transaction, state: LocalState)
  }

  def balanceTx(
      coins: Seq[QualifiedCoinInfo],
      transaction: Either[Transaction, UnprovenTransaction],
  ): Either[
    Throwable,
    ((List[QualifiedCoinInfo], List[CoinInfo]), (List[QualifiedCoinInfo], List[CoinInfo])),
  ] = {
    val transactionCostModel = TransactionCostModel(
      inputFeeOverhead = tokenType.inputFeeOverhead.toJsBigInt,
      outputFeeOverhead = tokenType.outputFeeOverhead.toJsBigInt,
    )

    val (jsGuaranteedImbalances, jsFallibleImbalances) = toJsImbalances(transaction, BigInt(100000))

    val guaranteedImbalancesRecipe = Either
      .catchNonFatal(
        getBalanceRecipe(
          coins.map(coin => qualifiedCoinInfo.toJs(coin)).toJSArray,
          jsGuaranteedImbalances,
          transactionCostModel,
          tokenType.native.show,
        ),
      )
      .leftMap(error => {
        val cleanedErrorMessage = error.getMessage.replaceFirst("^Error: ", "")

        NotSufficientFunds(cleanedErrorMessage)
      })
      .map(balanceRecipe =>
        (
          balanceRecipe.inputs.map(input => qualifiedCoinInfo.fromJs(input)).toList,
          balanceRecipe.outputs.map(output => coinInfo.fromJs(output)).toList,
        ),
      )

    val fallibleImbalancesRecipe = jsFallibleImbalances match {
      case Some(fallibleImbalances) => {
        val remainingCoins = guaranteedImbalancesRecipe match {
          case Right((inputs, _)) => coins.filterNot(inputs.contains)
          case Left(_)            => coins
        }

        val recipe = Either
          .catchNonFatal(
            getBalanceRecipe(
              remainingCoins.map(coin => qualifiedCoinInfo.toJs(coin)).toJSArray,
              fallibleImbalances,
              transactionCostModel,
              tokenType.native.show,
            ),
          )
          .leftMap(error => {
            val cleanedErrorMessage = error.getMessage.replaceFirst("^Error: ", "")

            NotSufficientFunds(cleanedErrorMessage)
          })
          .map(balanceRecipe =>
            (
              balanceRecipe.inputs.map(input => qualifiedCoinInfo.fromJs(input)).toList,
              balanceRecipe.outputs.map(output => coinInfo.fromJs(output)).toList,
            ),
          )

        Option(recipe)
      }
      case None => None
    }

    for {
      guaranteed <- guaranteedImbalancesRecipe
      fallible <- fallibleImbalancesRecipe.getOrElse(Right((List.empty, List.empty)))
    } yield (guaranteed, fallible)
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def mapImbalancesToJs(imbalances: Map[TokenType, BigInt]): Imbalances = {
    imbalances
      .map { case (tokenType, tokenValue) =>
        val negativeTokenValue = if (tokenValue > 0) -tokenValue else tokenValue
        (tokenType.show, negativeTokenValue.toJsBigInt)
      }
      .toJSMap
      .asInstanceOf[Imbalances]
  }

  private def toJsImbalances(
      transaction: Either[Transaction, UnprovenTransaction],
      overheadFee: BigInt,
  ): (Imbalances, Option[Imbalances]) = {
    val (guaranteedImbalances, fallibleImbalances) = transaction match {
      case Left(tx)          => calculateTxImbalances(tx, overheadFee)
      case Right(unprovenTx) => calculateUnprovenTxImbalances(unprovenTx, overheadFee)
    }

    val jsGuaranteedImbalances = mapImbalancesToJs(guaranteedImbalances)
    val jsFallibleImbalances =
      if fallibleImbalances.isEmpty then None
      else Some(mapImbalancesToJs(fallibleImbalances))

    (jsGuaranteedImbalances, jsFallibleImbalances)
  }

  /** Calculate the imbalances of a transaction with the given overhead fee
    *
    * @param tx
    *   transaction to calculate the imbalances for
    * @param overheadFee
    *   overhead fee to be added to the transaction
    */
  private def calculateTxImbalances(
      tx: Transaction,
      overheadFee: BigInt,
  ): (Map[TokenType, BigInt], Map[TokenType, BigInt]) = {
    val totalFees = tx.fees + overheadFee

    val fallibleImbalances = tx.fallibleCoins match {
      case Some(_) => tx.imbalances(false, totalFees)
      case None    => Map.empty
    }

    val guaranteedImbalances = tx.imbalances(true, totalFees)

    (guaranteedImbalances, fallibleImbalances)
  }

  /* overheadFee is needed because transactions have an additional fee
    besides the fees of the inputs/outputs that cannot be calculated at this point
    due to limitations from ledger
   */
  private def calculateUnprovenTxImbalances(
      unprovenTx: UnprovenTransaction,
      overheadFee: BigInt,
  ): (Map[TokenType, BigInt], Map[TokenType, BigInt]) = {
    val inputFeeOverhead = tokenType.inputFeeOverhead
    val outputFeeOverhead = tokenType.outputFeeOverhead

    def mergeImbalances(
        imbalanceA: Map[TokenType, BigInt],
        imbalanceB: Map[TokenType, BigInt],
    ): Map[TokenType, BigInt] = {
      imbalanceB.foldLeft(imbalanceA) { case (acc, (tokenType, valueB)) =>
        val valueA = acc.getOrElse(tokenType, BigInt(0))
        // Convert both values to negative if positive
        val negativeValueA = if (valueA > 0) -valueA else valueA
        val negativeValueB = if (valueB > 0) -valueB else valueB

        acc.updated(tokenType, negativeValueA + negativeValueB)
      }
    }

    def calculateOfferFees(offer: Option[UnprovenOffer], overheadFee: BigInt): BigInt = {
      val inputsLength = offer.map(_.inputs.length).getOrElse(0)
      val outputsLength = offer.map(_.outputs.length).getOrElse(0)
      val variableOverheadFee = BigInt(inputsLength + outputsLength) * overheadFee

      (BigInt(inputsLength) * inputFeeOverhead) + (BigInt(
        outputsLength,
      ) * outputFeeOverhead) + variableOverheadFee
    }

    val guaranteedCoinsFees = calculateOfferFees(unprovenTx.guaranteedCoins, overheadFee)
    val fallibleCoinsFees = calculateOfferFees(unprovenTx.fallibleCoins, overheadFee)

    val guaranteedCoinsImbalances = unprovenTx.guaranteedCoins
      .map(_.deltas)
      .getOrElse(Map.empty)

    val fallibleCoinsImbalances = unprovenTx.fallibleCoins
      .map(_.deltas)
      .getOrElse(Map.empty)

    val totalGuaranteedCoinsImbalances =
      mergeImbalances(guaranteedCoinsImbalances, Map(tokenType.native -> guaranteedCoinsFees))
    val totalFallibleCoinsImbalances =
      if fallibleCoinsImbalances.isEmpty then Map.empty
      else mergeImbalances(fallibleCoinsImbalances, Map(tokenType.native -> fallibleCoinsFees))

    (totalGuaranteedCoinsImbalances, totalFallibleCoinsImbalances)
  }

  case class NotSufficientFunds(message: String)
      extends Throwable(s"Not sufficient funds to balance token: $message")
}
