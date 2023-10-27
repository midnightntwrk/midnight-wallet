package io.iohk.midnight.wallet.engine.js

import cats.effect.{Deferred, IO}
import cats.syntax.applicative.*
import fs2.Stream
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.wallet.core.capabilities.{
  WalletBalances,
  WalletCoins,
  WalletKeys,
  WalletStateSerialize,
  WalletTxHistory,
}
import io.iohk.midnight.wallet.core.domain.{
  BalanceTransactionRecipe,
  BalanceTransactionToProve,
  NothingToProve,
  ProvingRecipe,
  TokenTransfer,
  TransactionIdentifier,
  TransactionToProve,
  ViewingUpdate,
}
import io.iohk.midnight.wallet.core.services.ProvingService
import io.iohk.midnight.wallet.core.{
  Wallet,
  WalletError,
  WalletStateService,
  WalletTransactionService,
  WalletTxSubmissionService,
}
import io.iohk.midnight.wallet.engine.WalletSyncService
import io.iohk.midnight.wallet.zswap.{
  CoinInfo,
  CoinPublicKey,
  EncryptionPublicKey,
  EncryptionSecretKey,
  LocalState,
  TokenType,
  Transaction,
}

class WalletSyncServiceStub extends WalletSyncService[IO] {
  override def updates: Stream[IO, Either[WalletError, ViewingUpdate]] = Stream.empty
  override def stop: IO[Unit] = IO.unit
}

class WalletStateServiceStub extends WalletStateService[IO, Wallet] {
  private val state = LocalState()

  override def keys(implicit
      walletKeys: WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
  ): IO[(CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)] =
    IO.pure((state.coinPublicKey, state.encryptionPublicKey, state.encryptionSecretKey))

  override def state(using
      walletKeys: WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
      walletBalances: WalletBalances[Wallet],
      walletCoins: WalletCoins[Wallet],
      walletTxHistory: WalletTxHistory[Wallet, Transaction],
  ): Stream[IO, WalletStateService.State] =
    Stream.emit(
      WalletStateService.State(
        state.coinPublicKey,
        state.encryptionPublicKey,
        state.encryptionSecretKey,
        state.coins.groupMapReduce(_.tokenType)(_.value)(_ + _),
        state.coins,
        state.coins,
        Seq.empty,
      ),
    )

  def serializeState(using
      stateSerializer: WalletStateSerialize[Wallet, SerializedWalletState],
  ): IO[SerializedWalletState] =
    IO.pure(SerializedWalletState(Wallet.Snapshot(state, Seq.empty, None).serialize))
}

class WalletSyncServiceStartStub(ref: Deferred[IO, Boolean]) extends WalletSyncService[IO] {
  override val updates: Stream[IO, Either[WalletError, ViewingUpdate]] =
    Stream.eval(ref.complete(true)).flatMap(_ => Stream.empty)
  override def stop: IO[Unit] = IO.unit
}

class WalletStateServiceBalanceStub(balance: BigInt) extends WalletStateService[IO, Wallet] {
  override def keys(implicit
      walletKeys: WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
  ): IO[(CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)] =
    IO.raiseError(new NotImplementedError())

  override def state(using
      walletKeys: WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
      walletBalances: WalletBalances[Wallet],
      walletCoins: WalletCoins[Wallet],
      walletTxHistory: WalletTxHistory[Wallet, Transaction],
  ): Stream[IO, WalletStateService.State] = {
    val state = LocalState()
    Stream.emit(
      WalletStateService.State(
        state.coinPublicKey,
        state.encryptionPublicKey,
        state.encryptionSecretKey,
        Map(TokenType.Native -> balance),
        Seq.empty,
        Seq.empty,
        Seq.empty,
      ),
    )
  }

  def serializeState(using
      stateSerializer: WalletStateSerialize[Wallet, SerializedWalletState],
  ): IO[SerializedWalletState] = IO.raiseError(Exception("Not implemented"))
}

class WalletStateServicePubKeyStub(coinPubKey: CoinPublicKey, encPubKey: EncryptionPublicKey)
    extends WalletStateService[IO, Wallet] {
  override def keys(implicit
      walletKeys: WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
  ): IO[(CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)] =
    IO.raiseError(new NotImplementedError())

  override def state(using
      walletKeys: WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
      walletBalances: WalletBalances[Wallet],
      walletCoins: WalletCoins[Wallet],
      walletTxHistory: WalletTxHistory[Wallet, Transaction],
  ): Stream[IO, WalletStateService.State] =
    Stream.emit(
      WalletStateService.State(
        coinPubKey,
        encPubKey,
        LocalState().encryptionSecretKey,
        Map.empty,
        Seq.empty,
        Seq.empty,
        Seq.empty,
      ),
    )

  def serializeState(using
      stateSerializer: WalletStateSerialize[Wallet, SerializedWalletState],
  ): IO[SerializedWalletState] = IO.raiseError(Exception("Not implemented"))
}

class WalletTxSubmissionServiceStub extends WalletTxSubmissionService[IO] {
  override def submitTransaction(
      transaction: Transaction,
  ): IO[TransactionIdentifier] =
    transaction.identifiers.headOption
      .fold[IO[TransactionIdentifier]](IO.raiseError(new Exception("Invalid tx")))(txId =>
        IO.pure(TransactionIdentifier(txId)),
      )
}

class WalletTransactionServiceStub() extends WalletTransactionService[IO] {
  override def prepareTransferRecipe(outputs: List[TokenTransfer]): IO[TransactionToProve] =
    IO.raiseError(new NotImplementedError())

  override def proveTransaction(provingRecipe: ProvingRecipe): IO[Transaction] =
    IO.raiseError(new NotImplementedError())

  override def balanceTransaction(
      tx: Transaction,
      newCoins: Seq[CoinInfo],
  ): IO[BalanceTransactionRecipe] =
    IO.raiseError(new NotImplementedError())
}

class WalletTransactionServiceWithProvingStub(
    provingService: ProvingService[IO],
    transferRecipe: TransactionToProve,
) extends WalletTransactionService[IO] {
  override def prepareTransferRecipe(outputs: List[TokenTransfer]): IO[TransactionToProve] =
    IO.pure(transferRecipe)

  override def proveTransaction(provingRecipe: ProvingRecipe): IO[Transaction] = {
    provingRecipe match
      case TransactionToProve(transaction) =>
        provingService.proveTransaction(transaction)
      case BalanceTransactionToProve(toProve, toBalance) =>
        provingService
          .proveTransaction(toProve)
          .map { provedTx =>
            toBalance.merge(provedTx)
          }
      case NothingToProve(transaction) => transaction.pure
  }

  override def balanceTransaction(
      tx: Transaction,
      newCoins: Seq[CoinInfo],
  ): IO[BalanceTransactionRecipe] =
    IO.pure(NothingToProve(tx))
}
