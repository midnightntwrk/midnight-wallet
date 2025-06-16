package io.iohk.midnight.wallet.core.instances

import cats.syntax.either.given
import io.iohk.midnight.wallet.core.WalletError
import io.iohk.midnight.wallet.core.WalletError.InvalidAddress
import io.iohk.midnight.wallet.core.capabilities.WalletTxTransfer
import io.iohk.midnight.wallet.core.domain.{Address, AppliedTransaction, ApplyStage, TokenTransfer}
import io.iohk.midnight.wallet.zswap
import io.iohk.midnight.wallet.zswap.UnprovenOutput.Segment
import io.iohk.midnight.midnightNtwrkWalletApi.distTypesMod.TokenTransfer as ApiTokenTransfer
import io.iohk.midnight.wallet.core.instances.DefaultTransferCapability.parseApiTokenTransfers
import io.iohk.midnight.wallet.core.parser.{AddressParser, Bech32Decoder, HexDecoder}
import io.iohk.midnight.wallet.zswap.given
import io.iohk.midnight.js.interop.util.BigIntOps.toScalaBigInt

import scala.scalajs.js
import scala.scalajs.js.annotation.{JSExport, JSExportAll, JSExportTopLevel}

@JSExportTopLevel("DefaultTransferCapabilityInstance")
@JSExportAll
class DefaultTransferCapability[
    TWallet,
    LocalState,
    SecretKeys,
    Transaction,
    TokenType,
    Offer,
    ProofErasedTransaction,
    CoinInfo,
    CoinPublicKey,
    EncPublicKey,
    UnprovenInput,
    ProofErasedOffer,
    MerkleTreeCollapsedUpdate,
    UnprovenTransaction,
    UnprovenOffer,
    UnprovenOutput,
](using
    applyTransaction: (TWallet, AppliedTransaction[Transaction]) => TWallet,
    getState: TWallet => LocalState,
    applyState: (TWallet, LocalState) => TWallet,
    getNetworkId: TWallet => zswap.NetworkId,
    tokenType: zswap.TokenType[TokenType, ?],
    unprovenOutput: zswap.UnprovenOutput[UnprovenOutput, CoinInfo, CoinPublicKey, EncPublicKey],
    unprovenOffer: zswap.UnprovenOffer[UnprovenOffer, UnprovenInput, UnprovenOutput, TokenType],
    unprovenTx: zswap.UnprovenTransaction.HasCoins[UnprovenTransaction, UnprovenOffer],
    unprovenTxCanEraseProofs: zswap.UnprovenTransaction.CanEraseProofs[
      UnprovenTransaction,
      ProofErasedTransaction,
    ],
    proofErasedTx: zswap.ProofErasedTransaction[
      ProofErasedTransaction,
      ?,
      ProofErasedOffer,
      TokenType,
    ],
    coinInfo: zswap.CoinInfo[CoinInfo, TokenType],
    evolveState: zswap.LocalState.EvolveState[
      LocalState,
      SecretKeys,
      Offer,
      ProofErasedOffer,
      MerkleTreeCollapsedUpdate,
    ],
    hexDecoder: HexDecoder[Address[CoinPublicKey, EncPublicKey]],
    bechDecoder: Bech32Decoder[Address[CoinPublicKey, EncPublicKey]],
) extends WalletTxTransfer[
      TWallet,
      Transaction,
      UnprovenTransaction,
      TokenType,
      CoinPublicKey,
      EncPublicKey,
    ] {
  override def prepareTransferRecipe(
      outputs: Seq[TokenTransfer[TokenType, CoinPublicKey, EncPublicKey]],
  ): Either[WalletError, UnprovenTransaction] = {
    val maybeFinalOffer = outputs
      .filter(output => output.amount > BigInt(0))
      .map { tt =>
        val output = unprovenOutput.create(
          Segment.Guaranteed,
          coinInfo.create(tt.tokenType, tt.amount),
          tt.receiverAddress.coinPublicKey,
          tt.receiverAddress.encryptionPublicKey,
        )
        unprovenOffer.fromOutput(output, tt.tokenType, tt.amount)
      }
      .reduceOption((offerA, offerB) => offerA.merge(offerB))

    maybeFinalOffer match {
      case Some(offer) => Right(unprovenTx.create(offer))
      case None        => Left(WalletError.NoTokenTransfers)
    }
  }

  @JSExport("prepareTransferRecipe")
  def prepareTransferRecipeJS(
      wallet: TWallet,
      outputs: js.Array[ApiTokenTransfer],
  ): Either[WalletError, UnprovenTransaction] = {
    given zswap.NetworkId = getNetworkId(wallet)
    parseApiTokenTransfers[TokenType, CoinPublicKey, EncPublicKey](outputs).flatMap { transfers =>
      prepareTransferRecipe(transfers)
    }
  }

  override def applyFailedTransaction(
      wallet: TWallet,
      tx: Transaction,
  ): Either[WalletError, TWallet] =
    applyTransaction(wallet, AppliedTransaction(tx, ApplyStage.FailEntirely)).asRight

  override def applyFailedUnprovenTransaction(
      wallet: TWallet,
      tx: UnprovenTransaction,
  ): Either[WalletError, TWallet] = {
    val txProofErased = tx.eraseProofs
    val guaranteedReverted =
      txProofErased.guaranteedCoins.fold(getState(wallet))((offer) =>
        getState(wallet).applyFailedProofErased(offer),
      )
    val newState = txProofErased.fallibleCoins.fold(guaranteedReverted)(
      guaranteedReverted.applyFailedProofErased,
    )
    applyState(wallet, newState).asRight
  }
}

@JSExportTopLevel("DefaultTransferCapability")
@JSExportAll
object DefaultTransferCapability {
  import io.iohk.midnight.midnightNtwrkZswap.mod

  def createV1[TWallet](
      applyTransaction: js.Function2[TWallet, AppliedTransaction[mod.Transaction], TWallet],
      getState: js.Function1[TWallet, mod.LocalState],
      applyState: js.Function2[TWallet, mod.LocalState, TWallet],
      getNetworkId: js.Function1[TWallet, zswap.NetworkId],
  ): DefaultTransferCapability[
    TWallet,
    mod.LocalState,
    mod.SecretKeys,
    mod.Transaction,
    mod.TokenType,
    mod.Offer,
    mod.ProofErasedTransaction,
    mod.CoinInfo,
    mod.CoinPublicKey,
    mod.EncPublicKey,
    mod.UnprovenInput,
    mod.ProofErasedOffer,
    mod.MerkleTreeCollapsedUpdate,
    mod.UnprovenTransaction,
    mod.UnprovenOffer,
    mod.UnprovenOutput,
  ] = {
    given Function1[TWallet, mod.LocalState] = getState

    given Function2[TWallet, mod.LocalState, TWallet] = applyState

    given Function2[TWallet, AppliedTransaction[mod.Transaction], TWallet] = applyTransaction

    given Function1[TWallet, zswap.NetworkId] = getNetworkId

    new DefaultTransferCapability()
  }

  def parseTokenTransfer[TokenType, CoinPublicKey, EncPublicKey](
      apiTransfer: ApiTokenTransfer,
  )(using
      networkId: zswap.NetworkId,
      tokenType: zswap.TokenType[TokenType, ?],
      hexDecoder: HexDecoder[Address[CoinPublicKey, EncPublicKey]],
      bechDecoder: Bech32Decoder[Address[CoinPublicKey, EncPublicKey]],
  ): Either[WalletError, TokenTransfer[TokenType, CoinPublicKey, EncPublicKey]] = {
    AddressParser
      .decode[Address[CoinPublicKey, EncPublicKey]](apiTransfer.receiverAddress)
      .leftMap(InvalidAddress.apply)
      .map(address =>
        TokenTransfer(
          apiTransfer.amount.toScalaBigInt,
          tokenType.fromJS(apiTransfer.`type`),
          address,
        ),
      )
  }

  def parseApiTokenTransfers[TokenType, CoinPublicKey, EncPublicKey](
      outputs: js.Array[ApiTokenTransfer],
  )(using
      zswap.NetworkId,
      zswap.TokenType[TokenType, ?],
      HexDecoder[Address[CoinPublicKey, EncPublicKey]],
      Bech32Decoder[Address[CoinPublicKey, EncPublicKey]],
  ): Either[WalletError, Seq[TokenTransfer[TokenType, CoinPublicKey, EncPublicKey]]] = {
    val (invalidAddresses, validTransfers) = outputs.toList
      .map(tt => parseTokenTransfer(tt))
      .partitionMap(identity)

    Either.cond(invalidAddresses.isEmpty, validTransfers, WalletError.Composite(invalidAddresses))
  }
}
