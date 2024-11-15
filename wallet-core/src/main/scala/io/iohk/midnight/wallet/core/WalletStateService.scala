package io.iohk.midnight.wallet.core

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.ProgressUpdate
import io.iohk.midnight.wallet.zswap

trait WalletStateService[
    CoinPublicKey,
    EncPubKey,
    EncSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
] {
  type TState = WalletStateService.State[
    CoinPublicKey,
    EncPubKey,
    EncSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
  ]

  def keys: IO[(CoinPublicKey, EncPubKey, EncSecretKey)]
  def state: Stream[IO, TState]
  def serializeState: IO[SerializedWalletState]
  def calculateCost(tx: Transaction): BigInt
}

object WalletStateService {
  case class SerializedWalletState(serializedState: String)

  final case class State[
      CoinPubKey,
      EncPubKey,
      EncSecretKey,
      TokenType,
      QualifiedCoinInfo,
      CoinInfo,
      Nullifier,
      Transaction,
  ](
      coinPublicKey: CoinPubKey,
      encryptionPublicKey: EncPubKey,
      viewingKey: EncSecretKey,
      balances: Map[TokenType, BigInt],
      coins: Seq[QualifiedCoinInfo],
      nullifiers: Seq[Nullifier],
      availableCoins: Seq[QualifiedCoinInfo],
      pendingCoins: Seq[CoinInfo],
      transactionHistory: Seq[Transaction],
      syncProgress: ProgressUpdate,
  )(using zswap.CoinPublicKey[CoinPubKey], zswap.EncryptionPublicKey[EncPubKey]) {
    lazy val address: zswap.Address[CoinPubKey, EncPubKey] =
      zswap.Address(coinPublicKey, encryptionPublicKey)
  }

  def calculateCost[
      Transaction,
      TokenType,
  ](tx: Transaction)(using
      zswap.Transaction.HasImbalances[Transaction, TokenType],
      zswap.Transaction.Transaction[Transaction, ?],
  )(using tt: zswap.TokenType[TokenType, ?]): BigInt =
    tx.imbalances(true, tx.fees).getOrElse(tt.native, BigInt(0))
}

class WalletStateServiceFactory[
    TWallet,
    CoinPublicKey,
    EncPubKey,
    EncSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
](using
    WalletKeys[TWallet, CoinPublicKey, EncPubKey, EncSecretKey],
    WalletBalances[TWallet, TokenType],
    WalletCoins[TWallet, QualifiedCoinInfo, CoinInfo, Nullifier],
    WalletTxHistory[TWallet, Transaction],
    WalletStateSerialize[TWallet, WalletStateService.SerializedWalletState],
    zswap.Transaction.HasImbalances[Transaction, TokenType],
    zswap.Transaction.Transaction[Transaction, ?],
    zswap.CoinPublicKey[CoinPublicKey],
    zswap.EncryptionPublicKey[EncPubKey],
)(using
    tt: zswap.TokenType[TokenType, ?],
) {
  private type Service = WalletStateService[
    CoinPublicKey,
    EncPubKey,
    EncSecretKey,
    TokenType,
    QualifiedCoinInfo,
    CoinInfo,
    Nullifier,
    Transaction,
  ]

  def create(walletQueryStateService: WalletQueryStateService[TWallet]): Service =
    new Service {
      override def keys: IO[(CoinPublicKey, EncPubKey, EncSecretKey)] =
        walletQueryStateService.queryOnce { wallet =>
          (wallet.coinPublicKey, wallet.encryptionPublicKey, wallet.viewingKey)
        }

      override def state: Stream[IO, TState] =
        walletQueryStateService.queryStream { wallet =>
          WalletStateService.State(
            coinPublicKey = wallet.coinPublicKey,
            encryptionPublicKey = wallet.encryptionPublicKey,
            viewingKey = wallet.viewingKey,
            balances = wallet.balance,
            coins = wallet.coins,
            nullifiers = wallet.nullifiers,
            availableCoins = wallet.availableCoins,
            pendingCoins = wallet.pendingCoins,
            transactionHistory = wallet.transactionHistory,
            syncProgress = wallet.progress,
          )
        }

      override def serializeState: IO[SerializedWalletState] =
        walletQueryStateService.queryOnce { _.serialize }

      // TODO improve returning type or add estimated fee to recipe
      override def calculateCost(tx: Transaction): BigInt =
        tx.imbalances(true, tx.fees).getOrElse(tt.native, BigInt(0))
    }
}
