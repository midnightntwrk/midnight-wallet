package io.iohk.midnight.wallet.core

import io.iohk.midnight.wallet.blockchain.data.Transaction as WalletTransaction
import io.iohk.midnight.wallet.core.capabilities.{
  WalletBalances,
  WalletCreation,
  WalletKeys,
  WalletRestore,
  WalletSync,
  WalletTxBalancing,
}
import io.iohk.midnight.wallet.core.domain.*
import Generators.*
import cats.data.NonEmptyList
import io.iohk.midnight.wallet.zswap.*
import io.iohk.midnight.wallet.core.util.WithProvingServerSuite

class WalletsSpec extends WithProvingServerSuite {

  private val emptyState = LocalState()

  private val (unprovenTx, stateForFunds) = generateTransactionWithFundsFor(
    NonEmptyList.one((TokenType.Native, BigInt(10000000))),
    emptyState,
  )

  private val stateWithFunds =
    stateForFunds.applyProofErased(unprovenTx.eraseProofs.guaranteedCoins)

  private val startingChainState =
    ZswapChainState().tryApplyProofErased(unprovenTx.eraseProofs.guaranteedCoins)

  private val regularWallet =
    summon[WalletCreation[Wallet, LocalState]].create(stateWithFunds)

  private val receiverState = LocalState()

  private val viewingKey: EncryptionSecretKey =
    summon[WalletKeys[Wallet, CoinPublicKey, EncryptionSecretKey]].viewingKey(regularWallet)

  private val viewingWallet =
    summon[WalletRestore[ViewingWallet, EncryptionSecretKey]].restore(viewingKey)

  test("ViewingWallet must prepare updates for Wallet") {
    val (regularWalletUsedForTransfer, transferRecipe) =
      summon[WalletTxBalancing[Wallet, Transaction, CoinInfo]].prepareTransferRecipe(
        regularWallet,
        List(
          TokenTransfer(
            BigInt(1000),
            TokenType.Native,
            Address(receiverState.coinPublicKey),
          ),
        ),
      ) match
        case Left(value)   => fail(s"Preparing tx failed: ${value.message}")
        case Right(result) => result

    provingService.proveTransaction(transferRecipe.transaction).map { tx =>
      val chainState = startingChainState.tryApply(tx.guaranteedCoins)

      val updatedViewingWallet = summon[WalletSync[ViewingWallet, WalletTransaction]]
        .applyUpdate(viewingWallet, LedgerSerialization.toTransaction(tx)) match
        case Left(value)             => fail(s"Syncing viewing wallet failed: ${value.message}")
        case Right(newViewingWallet) => newViewingWallet

      val viewingUpdate =
        updatedViewingWallet.prepareUpdate(None, stateWithFunds.firstFree, chainState)

      val updatedRegularWallet = summon[WalletSync[Wallet, ViewingUpdate]]
        .applyUpdate(regularWalletUsedForTransfer, viewingUpdate) match
        case Left(value)             => fail(s"Syncing regular wallet failed: ${value.message}")
        case Right(newRegularWallet) => newRegularWallet

      val startBalance =
        summon[WalletBalances[Wallet]].balance(regularWallet).getOrElse(TokenType.Native, BigInt(0))
      val endBalance =
        summon[WalletBalances[Wallet]]
          .balance(updatedRegularWallet)
          .getOrElse(TokenType.Native, BigInt(0))

      assert(startBalance > endBalance)
    }

  }

}
