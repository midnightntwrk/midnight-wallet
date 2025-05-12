package io.iohk.midnight.wallet.integration_tests.engine

import cats.data.NonEmptyList
import cats.effect.*
import cats.syntax.all.*
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightNtwrkWalletSdkAddressFormat.mod.ShieldedAddress
import io.iohk.midnight.midnightNtwrkWalletApi.distTypesMod.{
  ProvingRecipe as ApiProvingRecipe,
  TokenTransfer as ApiTokenTransfer,
}
import io.iohk.midnight.midnightNtwrkWalletApi.mod.{NOTHING_TO_PROVE, TRANSACTION_TO_PROVE}
import io.iohk.midnight.wallet.core.Generators.{*, given}
import io.iohk.midnight.wallet.core.capabilities.WalletTxHistory
import io.iohk.midnight.wallet.core.combinator.{
  CombinationMigrations,
  VersionCombination,
  VersionCombinator,
}
import io.iohk.midnight.wallet.core.domain.{ProvingRecipe, TokenTransfer}
import io.iohk.midnight.wallet.core.{
  SnapshotInstances,
  WalletInstances,
  domain,
  Wallet as CoreWallet,
}
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.given
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.core.parser.AddressParser
import io.iohk.midnight.wallet.engine.js.{JsWallet, ProvingRecipeTransformer}
import org.scalacheck.effect.PropF.forAllF

import scala.scalajs.js.JSConverters.*

class JsWalletTransactionsSpec extends WithProvingServerSuite {
  private given snapshots: SnapshotInstances[LocalState, Transaction] = new SnapshotInstances
  private val wallets: WalletInstances[
    LocalState,
    SecretKeys,
    Transaction,
    TokenType,
    Offer,
    ProofErasedTransaction,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    CoinPublicKey,
    EncryptionSecretKey,
    EncPublicKey,
    CoinSecretKey,
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
  ] = new WalletInstances

  type Wallet = CoreWallet[LocalState, SecretKeys, Transaction]

  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  private val transferRecipe =
    domain.TransactionToProve(unprovenTransactionArbitrary.arbitrary.sample.get)

  given WalletTxHistory[Wallet, Transaction] = wallets.walletDiscardTxHistory
  given networkId: zswap.NetworkId = zswap.NetworkId.Undeployed

  def jsWallet: Resource[IO, JsWallet] =
    for {
      bloc <- Bloc[VersionCombination](
        VersionCombinationStub(provingService, transferRecipe),
      )
      deferred <- Deferred[IO, Unit].toResource
      combinator = new VersionCombinator(bloc, CombinationMigrations.default, networkId, deferred)
    } yield new JsWallet(combinator, IO.unit, deferred)

  test("submitting a generic tx successfully should return the tx identifier") {
    forAllF { (txIO: IO[Transaction]) =>
      txIO.flatMap { tx =>
        @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
        val txIdentifier = tx.identifiers().headOption.get

        jsWallet
          .use(wallet => IO.fromPromise(IO(wallet.submitTransaction(tx))))
          .assertEquals(txIdentifier)
      }
    }
  }

  test("submitting transfer tokens should return recipe for transaction") {
    forAllF {
      (tokenTransfers: NonEmptyList[TokenTransfer[TokenType, CoinPublicKey, EncPublicKey]]) =>
        val apiTokenTransfers = tokenTransfers
          .map { case TokenTransfer(amount, tokenType, receiverAddress) =>
            val transferAddress =
              AddressParser.encodeAsBech32OrThrow[ShieldedAddress](receiverAddress)
            ApiTokenTransfer(amount.toJsBigInt, transferAddress, tokenType)
          }
          .toList
          .toJSArray
        jsWallet
          .use(wallet => IO.fromPromise(IO(wallet.transferTransaction(apiTokenTransfers))))
          .map { apiRecipe =>
            assertEquals(ProvingRecipeTransformer.toRecipe(apiRecipe), Right(transferRecipe))
          }
    }
  }

  test("submitting tx to prove should return proved transaction") {
    forAllF { (unprovenTx: UnprovenTransaction) =>
      jsWallet
        .use(wallet =>
          IO.fromPromise(IO {
            wallet.proveTransaction(
              ApiProvingRecipe.TransactionToProve(unprovenTx, TRANSACTION_TO_PROVE),
            )
          }),
        )
        .map { tx =>
          assertEquals(
            tx.guaranteedCoins.map(_.deltas.toMap),
            unprovenTx.guaranteedCoins.map(_.deltas.toMap),
          )
        }
    }
  }

  test("submitting proved tx to prove should return the same transaction") {
    forAllF { (provenTxIO: IO[Transaction]) =>
      provenTxIO.flatMap { provenTx =>
        jsWallet
          .use(wallet =>
            IO.fromPromise(
              IO(
                wallet.proveTransaction(
                  ApiProvingRecipe.NothingToProve(provenTx, NOTHING_TO_PROVE),
                ),
              ),
            ),
          )
          .assertEquals(provenTx)
      }
    }
  }

  test("submitting a generic tx for balance should return recipe for balanced transaction") {
    forAllF { (txWithContextIO: IO[TransactionWithContext]) =>
      txWithContextIO.flatMap {
        case TransactionWithContext(transaction, state, secretKeys, coins) =>
          jsWallet
            .use(wallet =>
              IO.fromPromise(IO(wallet.balanceTransaction(transaction, coins.toList.toJSArray))),
            )
            .map { apiRecipe =>
              assertEquals(
                ProvingRecipeTransformer.toRecipe(apiRecipe),
                Right(domain.NothingToProve(transaction)),
              )
            }
      }
    }
  }
}
