package io.iohk.midnight.wallet.engine.js

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.midnightLedger.mod.*
import io.iohk.midnight.wallet.core.BlockProcessingFactory.AppliedBlock
import io.iohk.midnight.wallet.core.capabilities.{WalletBalances, WalletKeys}
import io.iohk.midnight.wallet.core.{
  Wallet,
  WalletError,
  WalletFilterService,
  WalletStateService,
  WalletTxSubmissionService,
}
import io.iohk.midnight.wallet.engine.WalletBlockProcessingService

import scala.scalajs.js

class WalletFilterServiceStub(txs: Seq[Transaction]) extends WalletFilterService[IO] {
  override def installTransactionFilter(filter: Transaction => Boolean): Stream[IO, Transaction] =
    Stream.emits(txs)
}
class WalletFilterServiceFailingStub(txs: Seq[Transaction], error: Throwable)
    extends WalletFilterService[IO] {
  override def installTransactionFilter(filter: Transaction => Boolean): Stream[IO, Transaction] =
    Stream.emits(txs) ++ Stream.raiseError[IO](error)
}

class WalletFilterServiceInfiniteStub extends WalletFilterService[IO] {
  override def installTransactionFilter(filter: Transaction => Boolean): Stream[IO, Transaction] =
    Stream.never[IO]
}

class WalletBlockProcessingServiceStub extends WalletBlockProcessingService[IO] {
  override def blocks: Stream[IO, Either[WalletError, AppliedBlock]] = Stream.empty
  override def stop: IO[Unit] = IO.unit
}

class WalletStateServiceStub extends WalletStateService[IO, Wallet] {
  private val state = new ZSwapLocalState()
  override def publicKey(implicit walletKeys: WalletKeys[Wallet, ZSwapCoinPublicKey]) =
    IO.pure(state.coinPublicKey)
  override def balance(implicit walletBalances: WalletBalances[Wallet]) = Stream.emit(js.BigInt(0))
}

class WalletStateServicePublicKeyStub(zSwapCoinPublicKey: ZSwapCoinPublicKey)
    extends WalletStateService[IO, Wallet] {
  override def publicKey(implicit walletKeys: WalletKeys[Wallet, ZSwapCoinPublicKey]) =
    IO.pure(zSwapCoinPublicKey)
  override def balance(implicit walletBalances: WalletBalances[Wallet]) = Stream.emit(js.BigInt(0))
}

class WalletStateServiceBalanceStub(balance: Seq[js.BigInt])
    extends WalletStateService[IO, Wallet] {
  override def publicKey(implicit walletKeys: WalletKeys[Wallet, ZSwapCoinPublicKey]) =
    IO.raiseError(new NotImplementedError())
  override def balance(implicit walletBalances: WalletBalances[Wallet]) = Stream.emits(balance)
}

class WalletTxSubmissionServiceStub extends WalletTxSubmissionService[IO] {
  override def submitTransaction(
      transaction: Transaction,
      newCoins: List[CoinInfo],
  ): IO[TransactionIdentifier] =
    transaction
      .identifiers()
      .headOption
      .fold[IO[TransactionIdentifier]](IO.raiseError(new Exception("Invalid tx")))(IO.pure)
}

class WalletTxSubmissionServiceIdentifierStub(txIdentifier: TransactionIdentifier)
    extends WalletTxSubmissionService[IO] {
  override def submitTransaction(
      transaction: Transaction,
      newCoins: List[CoinInfo],
  ): IO[TransactionIdentifier] =
    IO.pure(txIdentifier)
}
