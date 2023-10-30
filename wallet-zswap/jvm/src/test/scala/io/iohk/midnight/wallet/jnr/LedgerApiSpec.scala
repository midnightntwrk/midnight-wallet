package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import io.iohk.midnight.wallet.jnr.Ledger.{JNRError, LedgerErrorResult, NumberResult, StringResult}
import munit.ScalaCheckSuite

import scala.util.{Failure, Success, Try}

@SuppressWarnings(Array("org.wartremover.warts.ToString", "org.wartremover.warts.OptionPartial"))
class LedgerApiSpec extends ScalaCheckSuite {

  private val validTx =
    "01010001000000000000000000000000000000000000000000"

  private val hexedEncryptionSecretKey =
    "20d70aa9e64eae18b2d0e374b98f429fd3ffc816b0e479606c5ad9e362ea971c0c"

  private val localState =
    "010000010000612c52b55b1d8265df62db079961e49a1701ba18239489e5da348811d0911d4b0100002008ef2c4ddcc9855b330b86b636a5b7f73e6ad71b2adf7b5d8f22ef381159a70b00000000000000000000000001000002200000000000000000"

  private val ledger = LedgerLoader.loadLedger.getOrElse(fail("Invalid ledger state"))

  private def failWithErrors(errors: NonEmptyList[JNRError]): Nothing = {
    fail(errors.map(_.toString).toList.mkString("\n"))
  }

  test("Set network id should be possible") {
    ledger.setNetworkId(NetworkId.Undeployed) match {
      case Left(error) => fail(error.toList.mkString(","))
      case Right(_)    => assert(true)
    }
  }

  test("Creation of MerkleTreeCollapsedUpdate should work") {
    val state = ledger.zswapChainStateNew().toOption.get.data
    val collapsedUpdateEither = ledger.merkleTreeCollapsedUpdateNew(state, 0, 1)

    collapsedUpdateEither match {
      case Left(errors) =>
        errors.toList.contains(LedgerErrorResult(LedgerError.MerkleTreeCollapsedUpdateNewError))
      case Right(StringResult(collapsedUpdate)) =>
        assert(collapsedUpdate.nonEmpty)
    }
  }

  test("Create new state, extract guaranteed coins from tx and apply to state should work") {
    val state = ledger.zswapChainStateNew().toOption.get.data
    val guaranteedCoins = ledger.extractGuaranteedCoinsFromTransaction(validTx).toOption.get.data
    val updatedState = ledger.zswapChainStateTryApply(state, guaranteedCoins).toOption.get

    assert(updatedState.data.nonEmpty)
  }

  test("Extracting guaranteed coins from transaction should work") {
    ledger.extractGuaranteedCoinsFromTransaction(validTx) match {
      case Left(errors)                         => failWithErrors(errors)
      case Right(StringResult(guaranteedCoins)) => assert(guaranteedCoins.nonEmpty)
    }
  }

  test("Extracting fallible coins from transaction should work") {
    ledger.extractFallibleCoinsFromTransaction(validTx) match {
      case Left(errors)                  => failWithErrors(errors)
      case Right(maybeFallibleCoinsData) => assert(true)
    }
  }

  test("ZswapChainState creation and getting first free index should work") {
    ledger.zswapChainStateNew() match {
      case Left(errors) => failWithErrors(errors)
      case Right(StringResult(state)) =>
        ledger.zswapChainStateFirstFree(state) match {
          case Left(errors)                        => failWithErrors(errors)
          case Right(NumberResult(firstFreeIndex)) => assert(firstFreeIndex >= 0)
        }
    }
  }

  test("Checking relevance without correct encryption key should give proper error") {
    Try(ledger.isTransactionRelevant(validTx, "invalid_secret_key")) match {
      case Failure(exception) => fail(exception.getMessage)
      case Success(result)    => assertEquals(result, LedgerError.EncryptionSecretKeyError)
    }
  }

  test("Checking relevance without correct tx should give proper error") {
    Try(
      ledger.isTransactionRelevant("invalid_tx", hexedEncryptionSecretKey),
    ) match {
      case Failure(exception) => fail(exception.getMessage)
      case Success(result)    => assertEquals(result, LedgerError.TransactionError)
    }
  }

  test("Applying tx to state should succeed") {
    ledger.applyTransactionToState(validTx, localState) match {
      case Left(errors)               => failWithErrors(errors)
      case Right(StringResult(state)) => assert(state.nonEmpty)
    }
  }

  test("Applying tx without correct tx should give proper error") {
    ledger.applyTransactionToState("invalid_tx", localState) match {
      case Left(errors) =>
        assert(errors.toList.contains(LedgerErrorResult(LedgerError.TransactionError)))
      case Right(StringResult(state)) => fail("Wrong case.")
    }
  }

  test("Applying tx without correct state should give proper error") {
    ledger.applyTransactionToState(validTx, "invalid_state") match {
      case Left(errors) =>
        assert(errors.toList.contains(LedgerErrorResult(LedgerError.StateError)))
      case Right(StringResult(state)) => fail("Wrong case.")
    }
  }
}
