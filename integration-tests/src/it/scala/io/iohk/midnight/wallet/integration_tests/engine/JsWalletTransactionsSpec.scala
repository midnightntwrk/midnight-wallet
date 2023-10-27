package io.iohk.midnight.wallet.integration_tests.engine

import cats.data.NonEmptyList
import cats.effect.IO
import cats.syntax.all.*
import io.iohk.midnight.js.interop.util.BigIntOps.*
import io.iohk.midnight.js.interop.util.MapOps.*
import io.iohk.midnight.midnightWalletApi.distTypesMod.{
  NOTHING_TO_PROVE,
  TRANSACTION_TO_PROVE,
  ProvingRecipe as ApiProvingRecipe,
  TokenTransfer as ApiTokenTransfer,
}
import io.iohk.midnight.wallet.core.Generators.{*, given}
import io.iohk.midnight.wallet.core.domain
import io.iohk.midnight.wallet.core.domain.{ProvingRecipe, TokenTransfer}
import io.iohk.midnight.wallet.engine.WalletSyncService
import io.iohk.midnight.wallet.engine.js.*
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.{Transaction, UnprovenTransaction}
import org.scalacheck.effect.PropF.forAllF
import scala.scalajs.js.JSConverters.*

class JsWalletTransactionsSpec extends WithProvingServerSuite {

  @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
  private val transferRecipe =
    domain.TransactionToProve(unprovenTransactionArbitrary.arbitrary.sample.get)

  def jsWallet(syncService: WalletSyncService[IO] = new WalletSyncServiceStub()): JsWallet =
    new JsWallet(
      syncService,
      new WalletStateServiceStub(),
      new WalletTxSubmissionServiceStub(),
      new WalletTransactionServiceWithProvingStub(provingService, transferRecipe),
      IO.unit,
    )

  test("submitting a generic tx successfully should return the tx identifier") {
    forAllF { (txIO: IO[Transaction]) =>
      txIO.flatMap { tx =>
        @SuppressWarnings(Array("org.wartremover.warts.OptionPartial"))
        val txIdentifier = tx.identifiers.headOption.get

        val promise = jsWallet().submitTransaction(tx.toJs)
        IO.fromPromise(IO(promise))
          .map { txId =>
            assert(txId === txIdentifier)
          }
      }
    }
  }

  test("submitting transfer tokens should return recipe for transaction") {
    forAllF { (tokenTransfers: NonEmptyList[TokenTransfer]) =>
      val apiTokenTransfers = tokenTransfers
        .map { case TokenTransfer(amount, tokenType, receiverAddress) =>
          ApiTokenTransfer(amount.toJsBigInt, receiverAddress.address, tokenType)
        }
        .toList
        .toJSArray
      val promise = jsWallet().transferTransaction(apiTokenTransfers)
      IO.fromPromise(IO(promise))
        .map { apiRecipe =>
          assertEquals(ProvingRecipeTransformer.toRecipe(apiRecipe), Right(transferRecipe))
        }
    }
  }

  test("submitting tx to prove should return proved transaction") {
    forAllF { (unprovenTx: UnprovenTransaction) =>
      val promise = jsWallet().proveTransaction(
        ApiProvingRecipe.TransactionToProve(unprovenTx.toJs, TRANSACTION_TO_PROVE),
      )
      IO.fromPromise(IO(promise))
        .map { tx =>
          assertEquals(
            tx.guaranteedCoins.deltas.toMap,
            unprovenTx.toJs.guaranteedCoins.deltas.toMap,
          )
        }
    }
  }

  test("submitting proved tx to prove should return the same transaction") {
    forAllF { (provenTxIO: IO[Transaction]) =>
      provenTxIO.flatMap { provenTx =>
        val promise =
          jsWallet().proveTransaction(
            ApiProvingRecipe.NothingToProve(provenTx.toJs, NOTHING_TO_PROVE),
          )
        IO.fromPromise(IO(promise))
          .map { tx =>
            assertEquals(tx, provenTx.toJs)
          }
      }
    }
  }

  test("submitting a generic tx for balance should return recipe for balanced transaction") {
    forAllF { (txWithContextIO: IO[TransactionWithContext]) =>
      txWithContextIO.flatMap { case TransactionWithContext(transaction, _, coins) =>
        val promise =
          jsWallet().balanceTransaction(transaction.toJs, coins.map(_.toJs).toList.toJSArray)
        IO.fromPromise(IO(promise))
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
