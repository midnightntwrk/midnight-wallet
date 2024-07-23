package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import io.iohk.midnight.wallet.jnr.LedgerV1.*
import munit.ScalaCheckSuite

@SuppressWarnings(Array("org.wartremover.warts.ToString", "org.wartremover.warts.OptionPartial"))
class LedgerApiSpec extends ScalaCheckSuite {

  override def munitIgnore: Boolean = scala.util.Properties.isMac

  private val validTx =
    "01010001000000000000000000000000000000000000000000"

  private val hexedEncryptionSecretKey =
    "010000206cbc420407d0c7eaaa2ef4f7a622440bf37773cd7f08f3107d16f2be060c1505"

  private val localState =
    "010000010000612c52b55b1d8265df62db079961e49a1701ba18239489e5da348811d0911d4b0100002008ef2c4ddcc9855b330b86b636a5b7f73e6ad71b2adf7b5d8f22ef381159a70b00000000000000000000000001000002200000000000000000"

  private lazy val ledger =
    LedgerLoader
      .loadLedger(networkId = Some(NetworkId.Undeployed), ProtocolVersion.V1)
      .getOrElse(fail("Invalid ledger state"))

  private def failWithErrors(errors: NonEmptyList[JNRError]): Nothing = {
    fail(errors.map(_.toString).toList.mkString("\n"))
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

  test("Extracting merkle tree root should work") {
    val state = ledger.zswapChainStateNew().toOption.get.data
    val root = ledger.zswapChainStateMerkleTreeRoot(state).toOption.get

    assertEquals(root.data, "00")
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

  test("Validating valid viewing key should succeed") {
    ledger.tryDeserializeEncryptionKey(hexedEncryptionSecretKey) match {
      case Left(errors)             => failWithErrors(errors)
      case Right(StringResult(key)) => assert(key.nonEmpty)
    }
  }

  test("Validating invalid viewing key should fail") {
    ledger.tryDeserializeEncryptionKey("wrong") match {
      case Left(errors) =>
        assert(errors.toList.contains(LedgerErrorResult(LedgerError.EncryptionSecretKeyError)))
      case Right(_) =>
        fail("Invalid viewing key returned valid")
    }
  }

  test("Checking relevance without correct encryption key should give proper error") {
    ledger.isTransactionRelevant(validTx, "invalid_secret_key") match {
      case Left(errors) =>
        assert(errors.toList.contains(LedgerErrorResult(LedgerError.EncryptionSecretKeyError)))
      case Right(BooleanResult(isRelevant)) =>
        fail("Should not be here!")
    }
  }

  test("Checking relevance without correct tx should give proper error") {
    ledger.isTransactionRelevant("invalid_tx", hexedEncryptionSecretKey) match {
      case Left(errors) =>
        assert(errors.toList.contains(LedgerErrorResult(LedgerError.TransactionError)))
      case Right(BooleanResult(isRelevant)) =>
        fail("Should not be here!")
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
