package io.iohk.midnight.wallet.core

import fs2.Stream
import io.iohk.midnight.wallet.core.WalletStateService.{SerializedWalletState, State}
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.ProgressUpdate
import io.iohk.midnight.wallet.zswap.*

trait WalletStateService[F[_], TWallet] {
  def keys(implicit
      walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
  ): F[(CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)]

  def state(using
      walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
      walletBalances: WalletBalances[TWallet],
      walletCoins: WalletCoins[TWallet],
      walletTxHistory: WalletTxHistory[TWallet, Transaction],
  ): Stream[F, State]

  def serializeState(using
      stateSerializer: WalletStateSerialize[TWallet, SerializedWalletState],
  ): F[SerializedWalletState]
}

object WalletStateService {
  class Live[F[_], TWallet](walletQueryStateService: WalletQueryStateService[F, TWallet])
      extends WalletStateService[F, TWallet] {

    override def keys(using
        walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
    ): F[(CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey)] =
      walletQueryStateService.queryOnce { wallet =>
        (
          walletKeys.coinPublicKey(wallet),
          walletKeys.encryptionPublicKey(wallet),
          walletKeys.viewingKey(wallet),
        )
      }

    override def state(using
        walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey],
        walletBalances: WalletBalances[TWallet],
        walletCoins: WalletCoins[TWallet],
        walletTxHistory: WalletTxHistory[TWallet, Transaction],
    ): Stream[F, State] =
      walletQueryStateService.queryStream { wallet =>
        State(
          coinPublicKey = walletKeys.coinPublicKey(wallet),
          encryptionPublicKey = walletKeys.encryptionPublicKey(wallet),
          viewingKey = walletKeys.viewingKey(wallet),
          balances = walletBalances.balance(wallet),
          coins = walletCoins.coins(wallet),
          availableCoins = walletCoins.availableCoins(wallet),
          pendingCoins = walletCoins.pendingCoins(wallet),
          transactionHistory = walletTxHistory.transactionHistory(wallet),
          syncProgress = walletTxHistory.progress(wallet),
        )
      }

    override def serializeState(using
        stateSerializer: WalletStateSerialize[TWallet, SerializedWalletState],
    ) =
      walletQueryStateService.queryOnce { wallet => stateSerializer.serialize(wallet) }
  }

  // TODO improve returning type or add estimated fee to recipe
  def calculateCost(tx: Transaction): BigInt = {
    tx.imbalances(true, tx.fees).getOrElse(TokenType.Native, BigInt(0))
  }

  final case class State(
      coinPublicKey: CoinPublicKey,
      encryptionPublicKey: EncryptionPublicKey,
      viewingKey: EncryptionSecretKey,
      balances: Map[TokenType, BigInt],
      coins: Seq[QualifiedCoinInfo],
      availableCoins: Seq[QualifiedCoinInfo],
      pendingCoins: Seq[CoinInfo],
      transactionHistory: Seq[Transaction],
      syncProgress: Option[ProgressUpdate],
  ) {
    lazy val address: Address = Address(coinPublicKey, encryptionPublicKey)
  }

  case class SerializedWalletState(serializedState: String)
}
