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
  NothingToProve,
  Seed,
  TokenTransfer,
  TransactionToProve,
  IndexerUpdate,
  ProgressUpdate,
  ViewingUpdate,
}
import io.iohk.midnight.wallet.zswap.*
import io.iohk.midnight.wallet.blockchain.data.Block
import io.iohk.midnight.wallet.core.WalletStateService.SerializedWalletState

final case class Wallet private (
    private val state: LocalState = LocalState(),
    txHistory: Vector[Transaction] = Vector.empty,
    blockHeight: Option[Block.Height] = None,
    progress: Option[ProgressUpdate] = None,
)

object Wallet {

  implicit val walletCreation: WalletCreation[Wallet, Wallet.Snapshot] =
    (snapshot: Wallet.Snapshot) =>
      Wallet(snapshot.state, snapshot.txHistory.toVector, snapshot.blockHeight)

  implicit val walletRestore: WalletRestore[Wallet, Seed] =
    (input: Seed) => new Wallet(LocalState.fromSeed(input.seed))

  implicit val walletBalances: WalletBalances[Wallet] = (wallet: Wallet) =>
    wallet.state.availableCoins.groupMapReduce(_.tokenType)(_.value)(_ + _)

  implicit val walletKeys
      : WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] =
    new WalletKeys[Wallet, CoinPublicKey, EncryptionPublicKey, EncryptionSecretKey] {
      override def coinPublicKey(wallet: Wallet): CoinPublicKey =
        wallet.state.coinPublicKey
      override def encryptionPublicKey(wallet: Wallet): EncryptionPublicKey =
        wallet.state.encryptionPublicKey
      override def viewingKey(wallet: Wallet): EncryptionSecretKey =
        wallet.state.encryptionSecretKey
    }

  implicit val walletCoins: WalletCoins[Wallet] =
    new WalletCoins[Wallet] {
      override def coins(wallet: Wallet): Seq[QualifiedCoinInfo] =
        wallet.state.coins
      override def availableCoins(wallet: Wallet): Seq[QualifiedCoinInfo] =
        wallet.state.availableCoins
    }

  implicit val walletTxBalancing
      : WalletTxBalancing[Wallet, Transaction, UnprovenTransaction, CoinInfo] =
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
        val guaranteedReverted = wallet.state.applyFailedProofErased(txProofErased.guaranteedCoins)
        val newState = txProofErased.fallibleCoins.fold(guaranteedReverted)(
          guaranteedReverted.applyFailedProofErased,
        )
        wallet.copy(state = newState).asRight
      }
    }

  implicit val walletSync: WalletSync[Wallet, IndexerUpdate] = {
    case (wallet: Wallet, update: ViewingUpdate) =>
      val newState =
        update.updates.foldLeft(wallet.state) {
          case (state, Left(mt))  => state.applyCollapsedUpdate(mt)
          case (state, Right(tx)) => applyTransaction(state, tx)
        }
      val newTxs = update.updates.collect { case Right(tx) => tx }
      wallet
        .copy(
          state = newState,
          txHistory = wallet.txHistory ++ newTxs.map(_.tx),
          blockHeight = Some(update.blockHeight),
        )
        .asRight

    case (wallet: Wallet, update: ProgressUpdate) =>
      wallet.copy(progress = Some(update)).asRight
  }

  private def applyTransaction(state: LocalState, transaction: AppliedTransaction): LocalState = {
    val tx = transaction.tx
    transaction.applyStage match {
      case ApplyStage.FailEntirely =>
        val guaranteed = state.applyFailed(tx.guaranteedCoins)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.FailFallible =>
        val guaranteed = state.apply(tx.guaranteedCoins)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.applyFailed)
      case ApplyStage.SucceedEntirely =>
        val guaranteed = state.apply(transaction.tx.guaranteedCoins)
        tx.fallibleCoins.fold(guaranteed)(guaranteed.apply)
    }
  }

  implicit val walletTxHistory: WalletTxHistory[Wallet, Transaction] =
    new WalletTxHistory[Wallet, Transaction] {
      override def transactionHistory(wallet: Wallet): Seq[Transaction] = wallet.txHistory
      override def progress(wallet: Wallet): Option[ProgressUpdate] = wallet.progress
    }

  implicit val serializeState: WalletStateSerialize[Wallet, SerializedWalletState] =
    (wallet: Wallet) =>
      SerializedWalletState(
        Snapshot(wallet.state, wallet.txHistory, wallet.blockHeight).serialize,
      )

  final case class Snapshot(
      state: LocalState,
      txHistory: Seq[Transaction],
      blockHeight: Option[Block.Height],
  ) {
    def serialize: String = this.asJson.noSpaces
  }
  object Snapshot {
    def parse(serialized: String): Either[Throwable, Snapshot] =
      decode[Snapshot](serialized)

    def fromSeed(seed: String): Either[Throwable, Snapshot] =
      LedgerSerialization.fromSeed(seed).map(Snapshot(_, Seq.empty, None))

    def create: Snapshot = Snapshot(LocalState(), Seq.empty, None)

    given Encoder[LocalState] = Encoder.instance(LedgerSerialization.serializeState(_).asJson)
    given Encoder[Transaction] = Encoder.instance(_.serialize.asJson)
    given Encoder[Block.Height] = Encoder.encodeBigInt.contramap(_.value)
    given Encoder[Snapshot] = deriveEncoder[Snapshot]
    given Decoder[LocalState] = Decoder[String].emapTry(LedgerSerialization.parseState(_).toTry)
    given Decoder[Transaction] =
      Decoder[String].emapTry(HexUtil.decodeHex).map(Transaction.deserialize)
    given Decoder[Block.Height] = Decoder[BigInt].emap(Block.Height.apply)
    given Decoder[Snapshot] = deriveDecoder[Snapshot]
  }
}
