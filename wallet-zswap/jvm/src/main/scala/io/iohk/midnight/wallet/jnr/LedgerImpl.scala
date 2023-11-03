package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import io.iohk.midnight.wallet.jnr.Ledger.*
import jnr.ffi.Pointer

import java.nio.charset.StandardCharsets
import scala.util.Try

class LedgerImpl(ledgerAPI: LedgerAPI, networkIdOpt: Option[NetworkId]) extends Ledger {

  override def isTransactionRelevant(
      tx: String,
      encryptionKeySerialized: String,
  ): Either[NonEmptyList[JNRError], BooleanResult] = {
    val callTry = Try {
      ledgerAPI.is_transaction_relevant(
        tx.getBytes(StandardCharsets.UTF_8),
        tx.length,
        encryptionKeySerialized.getBytes(StandardCharsets.UTF_8),
        encryptionKeySerialized.length,
      )
    }

    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultRaw(
        callTry = callTry,
        createResultEither = BooleanResult.applyEither,
      )
    } yield result
  }

  override def applyTransactionToState(
      tx: String,
      localState: String,
  ): Either[NonEmptyList[JNRError], StringResult] = {
    val callTry = Try {
      ledgerAPI.apply_transaction_to_state(
        tx.getBytes(StandardCharsets.UTF_8),
        tx.length,
        local_state = localState.getBytes(StandardCharsets.UTF_8),
        local_state_len = localState.length,
      )
    }

    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultAndFreePointer(
        callTry = callTry,
        freePointerTry = tryFreeStringResult,
        createResultEither = StringResult.applyEither,
      )
    } yield result
  }

  override def extractGuaranteedCoinsFromTransaction(
      tx: String,
  ): Either[NonEmptyList[JNRError], StringResult] = {
    val callTry = Try {
      ledgerAPI.extract_guaranteed_coins_from_transaction(
        tx.getBytes(StandardCharsets.UTF_8),
        tx.length,
      )
    }

    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultAndFreePointer(
        callTry = callTry,
        freePointerTry = tryFreeStringResult,
        createResultEither = StringResult.applyEither,
      )
    } yield result
  }

  override def extractFallibleCoinsFromTransaction(
      tx: String,
  ): Either[NonEmptyList[JNRError], Option[String]] = {
    val callTry = Try {
      ledgerAPI.extract_fallible_coins_from_transaction(
        tx.getBytes(StandardCharsets.UTF_8),
        tx.length,
      )
    }

    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultAndFreePointer(
        callTry = callTry,
        freePointerTry = tryFreeStringResult,
        createResultEither = StringResult.applyEither,
      ).map(_.optionalData)
    } yield result
  }

  override def zswapChainStateNew(): Either[NonEmptyList[JNRError], StringResult] =
    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultAndFreePointer(
        callTry = Try(ledgerAPI.zswap_chain_state_new()),
        freePointerTry = tryFreeStringResult,
        createResultEither = StringResult.applyEither,
      )
    } yield result

  override def zswapChainStateFirstFree(
      zswapChainState: String,
  ): Either[NonEmptyList[JNRError], NumberResult] = {
    val callTry = Try {
      ledgerAPI.zswap_chain_state_first_free(
        zswapChainState.getBytes(StandardCharsets.UTF_8),
        zswapChainState.length,
      )
    }

    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultAndFreePointer(
        callTry = callTry,
        freePointerTry = tryFreeNumberResult,
        createResultEither = NumberResult.applyEither,
      )
    } yield result
  }

  override def zswapChainStateTryApply(
      zswapChainState: String,
      offer: String,
  ): Either[NonEmptyList[JNRError], StringResult] = {
    val callTry = Try {
      ledgerAPI.zswap_chain_state_try_apply(
        zswapChainState.getBytes(StandardCharsets.UTF_8),
        zswapChainState.length,
        offer.getBytes(StandardCharsets.UTF_8),
        offer.length,
      )
    }

    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultAndFreePointer(
        callTry = callTry,
        freePointerTry = tryFreeStringResult,
        createResultEither = StringResult.applyEither,
      )
    } yield result
  }

  override def merkleTreeCollapsedUpdateNew(
      zswapChainState: String,
      indexStart: Long,
      indexEnd: Long,
  ): Either[NonEmptyList[JNRError], StringResult] = {
    val callTry = Try {
      ledgerAPI.merkle_tree_collapsed_update_new(
        zswapChainState.getBytes(StandardCharsets.UTF_8),
        zswapChainState.length,
        indexStart,
        indexEnd,
      )
    }

    for {
      _ <- setNetworkIdIfProvided(networkIdOpt)
      result <- createResultAndFreePointer(
        callTry = callTry,
        freePointerTry = tryFreeStringResult,
        createResultEither = StringResult.applyEither,
      )
    } yield result
  }

  private def setNetworkIdIfProvided(
      networkIdOpt: Option[NetworkId],
  ): Either[NonEmptyList[JNRError], Unit] = {
    def setupLedgerNetworkId(networkId: NetworkId) =
      createResultAndFreePointer(
        callTry = Try(ledgerAPI.set_network_id(networkId.id)),
        freePointerTry = tryFreeNumberResult,
        createResultEither = NumberResult.applyEither,
      )

    networkIdOpt.fold(Right(()))(setupLedgerNetworkId(_).map(_ => ()))
  }

  private def tryFreeStringResult(pointer: Pointer): Try[Unit] =
    Try(ledgerAPI.free_string_result(pointer))

  private def tryFreeNumberResult(pointer: Pointer): Try[Unit] =
    Try(ledgerAPI.free_number_result(pointer))

  private def createResultRaw[Result <: JNRSuccessCallResult](
      callTry: Try[Int],
      createResultEither: Int => Either[JNRError, Result],
  ): Either[NonEmptyList[JNRError], Result] = {

    val resultE = callTry.toEither match {
      case Left(throwable) =>
        Left(List(UnexpectedJNRError.apply(throwable)))

      case Right(rawInt) =>
        createResultEither(rawInt) match {
          case Left(resultError) =>
            Left(List(resultError))
          case Right(result) =>
            Right(result)
        }
    }

    resultE.left.map(NonEmptyList.fromListUnsafe)
  }

  private def createResultAndFreePointer[Result <: JNRSuccessCallResult](
      callTry: Try[Pointer],
      freePointerTry: Pointer => Try[Unit],
      createResultEither: Pointer => Either[JNRError, Result],
  ): Either[NonEmptyList[JNRError], Result] = {

    def freePointer(pointer: Pointer): Either[UnexpectedJNRError, Unit] = {
      freePointerTry(pointer).toEither.left
        .map(UnexpectedJNRError.apply)
    }

    val resultE = callTry.toEither match {
      case Left(throwable) =>
        Left(List(UnexpectedJNRError.apply(throwable)))

      case Right(pointer) =>
        createResultEither(pointer) match {
          case Left(resultError) =>
            freePointer(pointer) match {
              case Left(freeError)      => Left(List(resultError, freeError))
              case Right(properlyFreed) => Left(List(resultError))
            }
          case Right(result) =>
            freePointer(pointer) match {
              case Left(freeError)      => Left(List(freeError))
              case Right(properlyFreed) => Right(result)
            }
        }
    }

    resultE.left.map(NonEmptyList.fromListUnsafe)
  }
}
