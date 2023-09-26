package io.iohk.midnight.wallet.core

import fs2.Stream
import io.iohk.midnight.wallet.core.WalletStateService.State
import io.iohk.midnight.wallet.core.capabilities.{WalletBalances, WalletCoins, WalletKeys}
import io.iohk.midnight.wallet.zswap.{
  CoinPublicKey,
  EncryptionSecretKey,
  QualifiedCoinInfo,
  TokenType,
  Transaction,
}

trait WalletStateService[F[_], TWallet] {
  def keys(implicit
      walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionSecretKey],
  ): F[(CoinPublicKey, EncryptionSecretKey)]

  def state(using
      walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionSecretKey],
      walletBalances: WalletBalances[TWallet],
      walletCoins: WalletCoins[TWallet],
  ): Stream[F, State]
}

object WalletStateService {
  class Live[F[_], TWallet](walletQueryStateService: WalletQueryStateService[F, TWallet])
      extends WalletStateService[F, TWallet] {

    override def keys(using
        walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionSecretKey],
    ): F[(CoinPublicKey, EncryptionSecretKey)] =
      walletQueryStateService.queryOnce { wallet =>
        (walletKeys.publicKey(wallet), walletKeys.viewingKey(wallet))
      }

    override def state(using
        walletKeys: WalletKeys[TWallet, CoinPublicKey, EncryptionSecretKey],
        walletBalances: WalletBalances[TWallet],
        walletCoins: WalletCoins[TWallet],
    ): Stream[F, State] =
      walletQueryStateService.queryStream { wallet =>
        State(
          publicKey = walletKeys.publicKey(wallet),
          viewingKey = walletKeys.viewingKey(wallet),
          balances = walletBalances.balance(wallet),
          coins = walletCoins.coins(wallet),
          availableCoins = walletCoins.availableCoins(wallet),
          transactionHistory = Seq.empty,
        )
      }
  }

  // TODO improve returning type or add estimated fee to recipe
  def calculateCost(tx: Transaction): BigInt = {
    tx.imbalances(true, tx.fees).getOrElse(TokenType.Native, BigInt(0))
  }

  final case class State(
      publicKey: CoinPublicKey,
      viewingKey: EncryptionSecretKey,
      balances: Map[TokenType, BigInt],
      coins: Seq[QualifiedCoinInfo],
      availableCoins: Seq[QualifiedCoinInfo],
      transactionHistory: Seq[Transaction],
  )
}
