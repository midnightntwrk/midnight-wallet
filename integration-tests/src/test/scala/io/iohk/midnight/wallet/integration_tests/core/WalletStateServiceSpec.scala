package io.iohk.midnight.wallet.integration_tests.core

import cats.effect.{IO, Resource}
import io.iohk.midnight.bloc.Bloc
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.capabilities.{WalletCreation, WalletTxHistory}
import io.iohk.midnight.wallet.core.util.BetterOutputSuite
import io.iohk.midnight.wallet.core.*
import io.iohk.midnight.wallet.integration_tests.WithProvingServerSuite
import io.iohk.midnight.wallet.zswap.{LocalState, NetworkId, TokenType, Transaction}
import munit.{CatsEffectSuite, ScalaCheckEffectSuite}
import org.scalacheck.effect.PropF
import org.scalacheck.effect.PropF.forAllF

class WalletStateServiceSpec
    extends ScalaCheckEffectSuite
    with BetterOutputSuite
    with WithProvingServerSuite {
  def buildWalletStateService[TWallet](
      initialState: LocalState = LocalState(),
  )(implicit
      walletCreation: WalletCreation[TWallet, Wallet.Snapshot],
  ): Resource[IO, WalletStateService[IO, TWallet]] = {
    val snapshot = Wallet.Snapshot(initialState, Seq.empty, None, ProtocolVersion.V1, networkId)
    Bloc[IO, TWallet](walletCreation.create(snapshot)).map { bloc =>
      new WalletStateService.Live[IO, TWallet](
        new WalletQueryStateService.Live(
          new WalletStateContainer.Live(bloc),
        ),
      )
    }
  }

  import Wallet.*
  given WalletTxHistory[Wallet, Transaction] = Wallet.walletDiscardTxHistory
  given networkId: NetworkId = NetworkId.Undeployed

  test("Start with balance zero") {
    buildWalletStateService().use(
      _.state
        .map(_.balances.getOrElse(TokenType.Native, BigInt(0)))
        .head
        .compile
        .last
        .map(assertEquals(_, Some(BigInt(0)))),
    )
  }

  test("Sum transaction outputs to this wallet") {
    forAllF(Generators.txWithContextArbitrary.arbitrary) { txWithContextIO =>
      for {
        txWithContext <- txWithContextIO
        initialState =
          txWithContext.transaction.guaranteedCoins.fold(txWithContext.state)(
            txWithContext.state.apply,
          )
        expected =
          txWithContext.transaction.guaranteedCoins.flatMap(
            _.deltas
              .get(TokenType.Native)
              .map(value => -value),
          )
        result <- buildWalletStateService(initialState = initialState).use(
          _.state.head.compile.lastOrError
            .map(_.balances.get(TokenType.Native))
            .map(assertEquals(_, expected)),
        )
      } yield result
    }
  }

  test("Not sum transaction outputs to another wallet") {
    forAllF(Generators.ledgerTransactionArbitrary.arbitrary) { txWithCtxIO =>
      txWithCtxIO.flatMap { tx =>
        val anotherState = tx.guaranteedCoins.fold(LocalState())(LocalState.apply().apply)
        buildWalletStateService(initialState = anotherState).use(
          _.state.head.compile.lastOrError
            .map(_.balances.get(TokenType.Native))
            .map(assertEquals(_, None)),
        )
      }
    }
  }

  test("Return the public and viewing keys") {
    val initialState = LocalState()
    val expected =
      (
        initialState.coinPublicKey,
        initialState.encryptionPublicKey,
        initialState.encryptionSecretKey.serialize,
      )
    buildWalletStateService(initialState).use(
      _.keys.map((cpk, epk, vk) => (cpk, epk, vk.serialize)).assertEquals(expected),
    )
  }

  test("Calculate cost as the sum of tx imbalances") {
    forAllF(Generators.ledgerTransactionArbitrary.arbitrary) { txIO =>
      txIO.map { tx =>
        assertEquals(
          WalletStateService.calculateCost(tx),
          tx.imbalances(true, tx.fees).getOrElse(TokenType.Native, BigInt(0)),
        )
      }
    }
  }
}
