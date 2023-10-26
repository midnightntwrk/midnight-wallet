package io.iohk.midnight.wallet.integration_tests.core

import cats.data.NonEmptyList
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.Transaction as WalletTransaction
import io.iohk.midnight.wallet.core.Generators.*
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.{Address as DomainAddress, *}
import io.iohk.midnight.wallet.core.{LedgerSerialization, ViewingWallet, Wallet}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.*

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

  private val coinPublicKey: CoinPublicKey =
    summon[WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey]]
      .coinPublicKey(regularWallet)

  private val encryptionPublicKey: EncryptionPublicKey =
    summon[WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey]]
      .encryptionPublicKey(regularWallet)

  private val viewingKey: EncryptionSecretKey =
    summon[WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey]]
      .viewingKey(regularWallet)

  private val viewingWallet =
    summon[WalletRestore[ViewingWallet, (CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)]]
      .restore((coinPublicKey, encryptionPublicKey, viewingKey))

  test("ViewingWallet must prepare updates for Wallet") {
    val (regularWalletUsedForTransfer, transferRecipe) =
      summon[WalletTxBalancing[Wallet, Transaction, CoinInfo]].prepareTransferRecipe(
        regularWallet,
        List(
          TokenTransfer(
            BigInt(1000),
            TokenType.Native,
            DomainAddress(
              Address(receiverState.coinPublicKey, receiverState.encryptionPublicKey).asString,
            ),
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
        updatedViewingWallet
          .prepareUpdate(None, chainState, stateWithFunds.firstFree)

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

      assert(startBalance > endBalance, s"Start $startBalance, End $endBalance")
    }

  }

}
