package io.iohk.midnight.wallet.core.instances

import cats.syntax.all.*
import io.iohk.midnight.midnightNtwrkWalletApi.distTypesMod.ProvingRecipe as ApiProvingRecipe
import io.iohk.midnight.midnightNtwrkZswap.mod as zswapMod
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionToProve,
  NothingToProve,
  TransactionToProve,
}
import io.iohk.midnight.wallet.core.instances.DefaultBalancingCapability.{Recipe, ResultWithWallet}
import io.iohk.midnight.wallet.core.{TransactionBalancer, WalletError}
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.UnprovenOutput.Segment
import io.iohk.midnight.wallet.zswap.given

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportAll, JSExportTopLevel}

@JSExportTopLevel("DefaultBalancingCapabilityInstance")
@JSExportAll
class DefaultBalancingCapability[
    TWallet,
    Transaction,
    UnprovenTransaction,
    LocalState,
    TokenType,
    UnprovenOffer,
    UnprovenInput,
    UnprovenOutput,
    Offer,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    SecretKeys,
    CoinPublicKey,
    EncPublicKey,
](using
    transactionBalancer: TransactionBalancer[
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
    ],
    applyState: (TWallet, LocalState) => TWallet,
    getSk: (TWallet) => SecretKeys,
    getState: (TWallet) => LocalState,
    recipeConverter: Recipe[UnprovenTransaction, Transaction] => ApiProvingRecipe,
    coinsInstance: WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier],
    unprovenOffer: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
    canMerge: zswap.UnprovenTransaction.CanMerge[UnprovenTransaction],
    unprovenTx: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    stateHasCoins: zswap.LocalState.HasCoins[
      LocalState,
      SecretKeys,
      QualifiedCoinInfo,
      CoinInfo,
      UnprovenInput,
    ],
    coinInfo: zswap.CoinInfo[CoinInfo, TokenType],
    qualifiedCoinInfo: zswap.QualifiedCoinInfo[QualifiedCoinInfo, TokenType, ?],
    unprovenOutput: zswap.UnprovenOutput[UnprovenOutput, CoinInfo, CoinPublicKey, EncPublicKey],
    skHasCoinPublicKey: zswap.SecretKeys.HasCoinPublicKey[SecretKeys, CoinPublicKey],
    skHasEncPublicKey: zswap.SecretKeys.HasEncryptionPublicKey[SecretKeys, EncPublicKey],
) extends WalletTxBalancing[TWallet, Transaction, UnprovenTransaction, CoinInfo] {

  override def balanceTransaction(
      wallet: TWallet,
      transactionWithCoins: (Either[Transaction, UnprovenTransaction], Seq[CoinInfo]),
  ): Either[
    WalletError,
    (
        TWallet,
        Recipe[UnprovenTransaction, Transaction],
    ),
  ] = {
    val recipeResult =
      transactionBalancer.balanceTx(wallet.availableCoins, transactionWithCoins._1)

    val result = recipeResult.flatMap {
      case ((guaranteedInputs, guaranteedOutputs), (fallibleInputs, fallibleOutputs)) =>
        Either.catchNonFatal {
          // Process recipe parts (inputs + outputs) and return updated state and offer
          def processRecipe(
              segment: Segment,
              startingState: LocalState,
              secretKeys: SecretKeys,
              inputs: List[QualifiedCoinInfo],
              outputs: List[CoinInfo],
          ): (LocalState, UnprovenOffer) = {
            val startingOffer = unprovenOffer()
            // Process inputs
            val (stateAfterInputs, offerAfterInputs) =
              inputs.foldLeft((startingState, startingOffer)) { case ((state, offer), coin) =>
                val (newState, unprovenInput) = state.spend(segment, secretKeys, coin)
                val newOffer =
                  offer.merge(unprovenOffer.fromInput(unprovenInput, coin.tokenType, coin.value))
                (newState, newOffer)
              }

            // Process outputs
            outputs.foldLeft((stateAfterInputs, offerAfterInputs)) { case ((state, offer), coin) =>
              val unprovenOutputValue =
                unprovenOutput.create(
                  segment,
                  coin,
                  secretKeys.coinPublicKey,
                  secretKeys.encryptionPublicKey,
                )
              val newOffer = offer.merge(
                unprovenOffer.fromOutput(unprovenOutputValue, coin.tokenType, coin.value),
              )
              val newState = state.watchFor(secretKeys, coin)
              (newState, newOffer)
            }
          }

          // Process guaranteed part first
          val (stateAfterGuaranteed, guaranteedOffer) = processRecipe(
            Segment.Guaranteed,
            getState(wallet),
            getSk(wallet),
            guaranteedInputs,
            guaranteedOutputs,
          )

          val (finalState, finalTx) = if (fallibleInputs.isEmpty && fallibleOutputs.isEmpty) {
            // Skip fallible part completely if either inputs or outputs are empty
            (stateAfterGuaranteed, unprovenTx.create(guaranteedOffer))
          } else {
            // Only process fallible part when both inputs and outputs exist
            val (updatedState, fallibleOffer) = processRecipe(
              Segment.Fallible,
              stateAfterGuaranteed,
              getSk(wallet),
              fallibleInputs,
              fallibleOutputs,
            )
            (updatedState, unprovenTx.create(guaranteedOffer, fallibleOffer))
          }

          transactionBalancer.BalanceTransactionResult.BalancedTransactionAndState(
            finalTx,
            finalState,
          )
        }
    }

    handleBalancingResult(result, wallet, transactionWithCoins)
  }

  @JSExport("balanceTransaction")
  def balanceTransactionJs(
      wallet: TWallet,
      transaction: Either[Transaction, UnprovenTransaction],
      coins: js.Array[zswapMod.CoinInfo],
  ): Either[
    WalletError,
    ResultWithWallet[
      TWallet,
      ApiProvingRecipe,
    ],
  ] = {
    balanceTransaction(wallet, (transaction, coins.toSeq.map(coinInfo.fromJs)))
      .map { res =>
        new ResultWithWallet[
          TWallet,
          ApiProvingRecipe,
        ] {
          override val wallet: TWallet = res._1
          override val result: ApiProvingRecipe = recipeConverter(res._2)
        }
      }
  }

  private def handleBalancingResult(
      result: Either[Throwable, transactionBalancer.BalanceTransactionResult],
      wallet: TWallet,
      transactionWithCoins: (Either[Transaction, UnprovenTransaction], Seq[CoinInfo]),
  ): Either[
    WalletError,
    (
        TWallet,
        Recipe[UnprovenTransaction, Transaction],
    ),
  ] = {
    val (originalTransaction, coins) = transactionWithCoins
    result
      .map {
        case transactionBalancer.BalanceTransactionResult.BalancedTransactionAndState(
              unprovenTx,
              state,
            ) => {
          val updatedWallet = applyState(wallet, watchForCoins(getSk(wallet), state, coins))
          originalTransaction match {
            case Right(unprovenOriginalTx) =>
              val transactionToBalance = unprovenOriginalTx.merge(unprovenTx)
              (
                updatedWallet,
                TransactionToProve(transactionToBalance),
              )
            case Left(originalTx) =>
              (
                updatedWallet,
                BalanceTransactionToProve(unprovenTx, originalTx),
              )
          }
        }
        case transactionBalancer.BalanceTransactionResult.ReadyTransactionAndState(tx, state) =>
          (applyState(wallet, watchForCoins(getSk(wallet), state, coins)), NothingToProve(tx))
      }
      .leftMap { case transactionBalancer.NotSufficientFunds(error) =>
        WalletError.NotSufficientFunds(error)
      }
  }

  def watchForCoins(
      secretKeys: SecretKeys,
      state: LocalState,
      coins: Seq[CoinInfo],
  ): LocalState = {
    coins.foldLeft(state)((state, coin) => state.watchFor(secretKeys, coin))
  }
}

@JSExportTopLevel("DefaultBalancingCapability")
@JSExportAll
object DefaultBalancingCapability {
  import io.iohk.midnight.midnightNtwrkZswap.mod

  type Recipe[UnprovenTransaction, Transaction] = TransactionToProve[UnprovenTransaction] |
    BalanceTransactionToProve[UnprovenTransaction, Transaction] |
    NothingToProve[UnprovenTransaction, Transaction]

  given Function1[Recipe[mod.UnprovenTransaction, mod.Transaction], ApiProvingRecipe] =
    ProvingRecipeTransformer.toApiRecipe

  trait ResultWithWallet[TWallet, TResult] extends js.Object {
    val wallet: TWallet
    val result: TResult
  }

  def createV1[TWallet](
      coins: WalletCoins[TWallet, mod.QualifiedCoinInfo, mod.CoinInfo, mod.Nullifier],
      applyState: js.Function2[TWallet, mod.LocalState, TWallet],
      getSk: js.Function1[TWallet, mod.SecretKeys],
      getState: js.Function1[TWallet, mod.LocalState],
  ): DefaultBalancingCapability[
    TWallet,
    mod.Transaction,
    mod.UnprovenTransaction,
    mod.LocalState,
    mod.TokenType,
    mod.UnprovenOffer,
    mod.UnprovenInput,
    mod.UnprovenOutput,
    mod.Offer,
    mod.QualifiedCoinInfo,
    mod.CoinInfo,
    mod.Nullifier,
    mod.SecretKeys,
    mod.CoinPublicKey,
    mod.EncPublicKey,
  ] = {
    given balancer: TransactionBalancer[
      mod.LocalState,
      mod.TokenType,
      mod.UnprovenTransaction,
      mod.UnprovenOffer,
      mod.UnprovenInput,
      mod.UnprovenOutput,
      mod.Transaction,
      mod.Offer,
      mod.QualifiedCoinInfo,
      mod.CoinInfo,
    ] = TransactionBalancer[
      mod.LocalState,
      mod.TokenType,
      mod.UnprovenTransaction,
      mod.UnprovenOffer,
      mod.UnprovenInput,
      mod.UnprovenOutput,
      mod.Transaction,
      mod.Offer,
      mod.QualifiedCoinInfo,
      mod.CoinInfo,
    ]

    given WalletCoins[TWallet, mod.QualifiedCoinInfo, mod.CoinInfo, mod.Nullifier] = coins

    given Function1[TWallet, mod.SecretKeys] = getSk

    given Function1[TWallet, mod.LocalState] = getState

    given Function2[TWallet, mod.LocalState, TWallet] = applyState

    new DefaultBalancingCapability[
      TWallet,
      mod.Transaction,
      mod.UnprovenTransaction,
      mod.LocalState,
      mod.TokenType,
      mod.UnprovenOffer,
      mod.UnprovenInput,
      mod.UnprovenOutput,
      mod.Offer,
      mod.QualifiedCoinInfo,
      mod.CoinInfo,
      mod.Nullifier,
      mod.SecretKeys,
      mod.CoinPublicKey,
      mod.EncPublicKey,
    ]
  }
}
