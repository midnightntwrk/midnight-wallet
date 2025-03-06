package io.iohk.midnight.wallet.engine.js

import cats.effect.{Deferred, IO}
import fs2.Stream
import io.iohk.midnight.midnightNtwrkZswap.mod.*
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.{
  Generators,
  WalletStateService,
  WalletTransactionService,
  WalletTxSubmissionService,
}
import io.iohk.midnight.wallet.core.combinator.VersionCombination
import io.iohk.midnight.wallet.core.domain.ProgressUpdate
import io.iohk.midnight.wallet.zswap.given

class VersionCombinationStub(
    coinPubKey: CoinPublicKey,
    encPubKey: EncPublicKey,
    balance: BigInt,
    start: Deferred[IO, Boolean],
) extends VersionCombination {
  override def sync: IO[Unit] = start.complete(true).void

  override def state: Stream[
    IO,
    WalletStateService.State[
      CoinPublicKey,
      EncPublicKey,
      EncryptionSecretKey,
      TokenType,
      QualifiedCoinInfo,
      CoinInfo,
      Nullifier,
      Transaction,
    ],
  ] = {
    val secretKeys = Generators.keyGenerator()

    Stream(
      WalletStateService.State(
        coinPubKey,
        encPubKey,
        secretKeys.encryptionSecretKey,
        Map(nativeToken() -> balance),
        Seq.empty,
        Seq.empty,
        Seq.empty,
        Seq.empty,
        Seq.empty,
        ProgressUpdate.empty,
      ),
    )
  }

  override def serializeState: IO[WalletStateService.SerializedWalletState] =
    IO.raiseError(Exception("Test stub"))

  override def transactionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTransactionService[UnprovenTransaction, Transaction, CoinInfo, TokenType]] =
    IO.raiseError(Exception("Test stub"))

  override def submissionService(
      protocolVersion: ProtocolVersion,
  ): IO[WalletTxSubmissionService[Transaction]] = IO.raiseError(Exception("Test stub"))
}

object VersionCombinationStub {
  def apply(
      coinPubKey: CoinPublicKey = "",
      encPubKey: EncPublicKey = "",
      balance: BigInt = BigInt(1),
  ): IO[VersionCombinationStub] =
    Deferred[IO, Boolean].map(new VersionCombinationStub(coinPubKey, encPubKey, balance, _))
}
