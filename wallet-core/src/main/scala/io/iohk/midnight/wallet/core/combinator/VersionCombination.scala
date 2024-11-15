package io.iohk.midnight.wallet.core.combinator

import cats.effect.IO
import fs2.Stream
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.{
  WalletStateService,
  WalletTransactionService,
  WalletTxSubmissionService,
}
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState
import io.iohk.midnight.midnightNtwrkZswap.mod as v1

trait VersionCombination {
  def sync: IO[Unit]

  def state: Stream[
    IO,
    WalletStateService.State[
      v1.CoinPublicKey,
      v1.EncPublicKey,
      v1.EncryptionSecretKey,
      v1.TokenType,
      v1.QualifiedCoinInfo,
      v1.CoinInfo,
      v1.Nullifier,
      v1.Transaction,
    ],
  ]

  def serializeState: IO[SerializedWalletState]

  def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[
    WalletTransactionService[v1.UnprovenTransaction, v1.Transaction, v1.CoinInfo, v1.TokenType],
  ]

  def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[v1.Transaction]]
}
