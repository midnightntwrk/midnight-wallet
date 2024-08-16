package io.iohk.midnight.wallet.core

import cats.syntax.all.*
import io.circe.*
import io.circe.syntax.*
import io.circe.generic.semiauto.*
import io.circe.parser.decode
import io.iohk.midnight.wallet.core.TransactionBalancer.BalanceTransactionResult
import io.iohk.midnight.wallet.core.capabilities.*
import io.iohk.midnight.wallet.core.domain.{
  AppliedTransaction,
  ApplyStage,
  BalanceTransactionRecipe,
  BalanceTransactionToProve,
  ConnectionLost,
  IndexerUpdate,
  NothingToProve,
  ProgressUpdate,
  TokenTransfer,
  TransactionToProve,
  ViewingUpdate,
}
import io.iohk.midnight.wallet.zswap.*
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ProtocolVersion
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState

final case class Wallet private (
    private val state: LocalState = LocalState(),
    txHistory: Vector[Transaction] = Vector.empty,
    offset: Option[data.Transaction.Offset] = None,
    progress: ProgressUpdate = ProgressUpdate.empty,
    isConnected: Boolean = false,
)

object Wallet {

  given walletCreation: WalletCreation[Wallet, Wallet.Snapshot] =
    (snapshot: Wallet.Snapshot) =>
      Wallet(
        snapshot.state,
        snapshot.txHistory.toVector,
        snapshot.offset,
        ProgressUpdate(snapshot.offset.map(_.decrement), none),
      )

  given walletBalances: WalletBalances[Wallet] = (wallet: Wallet) =>
    wallet.state.availableCoins.groupMapReduce(_.tokenType)(_.value)(_ + _)

  given walletKeys: WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] =
    new WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] {
      override def coinPublicKey(wallet: Wallet): CoinPublicKey =
        wallet.state.coinPublicKey
      override def encryptionPublicKey(wallet: Wallet): EncryptionPublicKey =
        wallet.state.encryptionPublicKey
      override def viewingKey(wallet: Wallet): EncryptionSecretKey =
        wallet.state.encryptionSecretKey
    }

  given walletCoins: WalletCoins[Wallet] =
    new WalletCoins[Wallet] {
      override def coins(wallet: Wallet): Seq[QualifiedCoinInfo] =
        wallet.state.coins
      override def availableCoins(wallet: Wallet): Seq[QualifiedCoinInfo] =
        wallet.state.availableCoins
      override def pendingCoins(wallet: Wallet): Seq[CoinInfo] = wallet.state.pendingOutputs
    }

  given walletTxBalancing: WalletTxBalancing[Wallet, Transaction, UnprovenTransaction, CoinInfo] =
    new WalletTxBalancing[Wallet, Transaction, UnprovenTransaction, CoinInfo] {
      override def prepareTransferRecipe(
          wallet: Wallet,
          outputs: List[TokenTransfer],
      ): Either[WalletError, (Wallet, TransactionToProve)] = {
        val offers = outputs.filter(_.amount > BigInt(0)).traverse { tt =>
          Address
            .fromString(tt.receiverAddress.address)
            .map { address =>
              val output = UnprovenOutput(
                CoinInfo(tt.tokenType, tt.amount),
                address.coinPublicKey,
                address.encryptionPublicKey,
              )
              UnprovenOffer.fromOutput(output, tt.tokenType, tt.amount)
            }
            .toEither
            .leftMap(WalletError.InvalidAddress.apply)
        }

        offers.flatMap(_.reduceLeftOption(_.merge(_)) match
          case Some(offerToBalance) =>
            TransactionBalancer
              .balanceOffer(wallet.state, offerToBalance)
              .map { case (balancedOffer, newState) =>
                (
                  wallet.copy(state = newState),
                  TransactionToProve(UnprovenTransaction(balancedOffer)),
                )
              }
              .leftMap { case TransactionBalancer.NotSufficientFunds(error) =>
                WalletError.NotSufficientFunds(error)
              }
          case None =>
            Left(WalletError.NoTokenTransfers),
        )
      }

      override def balanceTransaction(
          wallet: Wallet,
          transactionWithCoins: (Transaction, Seq[CoinInfo]),
      ): Either[WalletError, (Wallet, BalanceTransactionRecipe)] = {
        val (transactionToBalance, coins) = transactionWithCoins
        TransactionBalancer
          .balanceTransaction(wallet.state, transactionToBalance)
          .map {
            case BalanceTransactionResult.BalancedTransactionAndState(unprovenTx, state) =>
              val updatedState = coins.foldLeft(state)(_.watchFor(_))
              (
                wallet.copy(state = updatedState),
                BalanceTransactionToProve(unprovenTx, transactionToBalance),
              )
            case BalanceTransactionResult.ReadyTransactionAndState(tx, state) =>
              val updatedState = coins.foldLeft(state)(_.watchFor(_))
              (wallet.copy(state = updatedState), NothingToProve(tx))
          }
          .leftMap { case TransactionBalancer.NotSufficientFunds(error) =>
            WalletError.NotSufficientFunds(error)
          }
      }

      override def applyFailedTransaction(
          wallet: Wallet,
          tx: Transaction,
      ): Either[WalletError, Wallet] =
        wallet
          .copy(state =
            applyTransaction(wallet.state, AppliedTransaction(tx, ApplyStage.FailEntirely)),
          )
          .asRight

      override def applyFailedUnprovenTransaction(
          wallet: Wallet,
          tx: UnprovenTransaction,
      ): Either[WalletError, Wallet] = {
        val txProofErased = tx.eraseProofs
        val guaranteedReverted =
          txProofErased.guaranteedCoins.fold(wallet.state)(wallet.state.applyFailedProofErased)
        val newState = txProofErased.fallibleCoins.fold(guaranteedReverted)(
          guaranteedReverted.applyFailedProofErased,
        )
        wallet.copy(state = newState).asRight
      }
    }

  given walletSync(using
      walletTxHistory: WalletTxHistory[Wallet, Transaction],
  ): WalletSync[Wallet, IndexerUpdate] with
    extension (wallet: Wallet) {
      override def apply(update: IndexerUpdate): Either[WalletError, Wallet] =
        update match {
          case update: ViewingUpdate =>
            val newState =
              update.updates.foldLeft(wallet.state) {
                case (state, Left(mt))  => state.applyCollapsedUpdate(mt)
                case (state, Right(tx)) => applyTransaction(state, tx)
              }
            val newTxs = update.updates.collect { case Right(tx) => tx }
            wallet
              .copy(
                state = newState,
                txHistory =
                  walletTxHistory.updateTxHistory(wallet.txHistory, newTxs.map(_.tx)).toVector,
                offset = Some(update.offset),
                isConnected = true,
                progress = wallet.progress.copy(synced = Some(update.offset.decrement)),
              )
              .asRight

          case update: ProgressUpdate =>
            wallet
              .copy(
                progress = wallet.progress.copy(total = update.total),
                isConnected = true,
              )
              .asRight

          case ConnectionLost =>
            val progressUpdated = wallet.progress.copy(wallet.progress.synced, total = None)
            wallet.copy(isConnected = false, progress = progressUpdated).asRight
        }
    }

  private def applyTransaction(state: LocalState, transaction: AppliedTransaction): LocalState = {
    val tx = transaction.tx
    transaction.applyStage match {
      case ApplyStage.FailEntirely =>
        val guaranteed = tx.guaranteedCoins.fold(state)(state.applyFailed)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.FailFallible =>
        val guaranteed = tx.guaranteedCoins.fold(state)(state.apply)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.SucceedEntirely =>
        val guaranteed = transaction.tx.guaranteedCoins.fold(state)(state.apply)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.apply)
    }
  }

  val walletTxHistory: WalletTxHistory[Wallet, Transaction] =
    new WalletTxHistory[Wallet, Transaction] {
      override def updateTxHistory(
          currentTxs: Seq[Transaction],
          newTxs: Seq[Transaction],
      ): Seq[Transaction] = currentTxs ++ newTxs
      override def transactionHistory(wallet: Wallet): Seq[Transaction] = wallet.txHistory
      override def progress(wallet: Wallet): ProgressUpdate = wallet.progress
    }

  val walletDiscardTxHistory: WalletTxHistory[Wallet, Transaction] =
    new WalletTxHistory[Wallet, Transaction] {
      override def updateTxHistory(
          currentTxs: Seq[Transaction],
          newTxs: Seq[Transaction],
      ): Seq[Transaction] = Seq.empty
      override def transactionHistory(wallet: Wallet): Seq[Transaction] = wallet.txHistory
      override def progress(wallet: Wallet): ProgressUpdate = wallet.progress
    }

  given serializeState: WalletStateSerialize[Wallet, SerializedWalletState] =
    (wallet: Wallet) =>
      SerializedWalletState(
        Snapshot(wallet.state, wallet.txHistory, wallet.offset, ProtocolVersion.V1).serialize,
      )

  final case class Snapshot(
      state: LocalState,
      txHistory: Seq[Transaction],
      offset: Option[data.Transaction.Offset],
      protocolVersion: ProtocolVersion,
  ) {
    def serialize: String = this.asJson.noSpaces
  }
  object Snapshot {
    def parse(serialized: String): Either[Throwable, Snapshot] =
      decode[Snapshot](serialized)

    def fromSeed(seed: String): Either[Throwable, Snapshot] =
      LedgerSerialization
        .fromSeed(seed, ProtocolVersion.V1)
        .map(Snapshot(_, Seq.empty, None, ProtocolVersion.V1))

    def create: Snapshot = Snapshot(LocalState(), Seq.empty, None, ProtocolVersion.V1)

    given Encoder[LocalState] =
      Encoder.instance(localState => HexUtil.encodeHex(localState.serialize).asJson)
    given Encoder[Transaction] = Encoder.instance(_.serialize.asJson)
    given Encoder[data.Transaction.Offset] = Encoder.encodeBigInt.contramap(_.value)
    given Encoder[ProtocolVersion] = Encoder[Int].contramap(_.version)
    given Encoder[Snapshot] = deriveEncoder[Snapshot]
    given (using version: ProtocolVersion): Decoder[LocalState] =
      Decoder[String].emapTry(HexUtil.decodeHex).map(LocalState.deserialize(_, version))
    given (using version: ProtocolVersion): Decoder[Transaction] =
      Decoder[String].emapTry(HexUtil.decodeHex).map(Transaction.deserialize(_, version))
    given Decoder[data.Transaction.Offset] = Decoder[BigInt].map(data.Transaction.Offset.apply)
    given Decoder[ProtocolVersion] = Decoder[Int].emapTry(ProtocolVersion.fromInt(_).toTry)
    given Decoder[Snapshot] =
      Decoder
        .instance(_.get[ProtocolVersion]("protocolVersion"))
        .flatMap { protocolVersion =>
          given ProtocolVersion = protocolVersion
          deriveDecoder[Snapshot]
        }
  }
}
