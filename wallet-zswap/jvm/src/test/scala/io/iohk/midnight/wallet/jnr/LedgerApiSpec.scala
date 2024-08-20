package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import io.iohk.midnight.wallet.jnr.LedgerV1.*
import munit.ScalaCheckSuite

@SuppressWarnings(Array("org.wartremover.warts.ToString", "org.wartremover.warts.OptionPartial"))
class LedgerApiSpec extends ScalaCheckSuite {

  override def munitIgnore: Boolean = scala.util.Properties.isMac

  private val validTx =
    "00030000000000030000000000000000000000000000000000000000"

  private val hexedEncryptionSecretKey =
    "000300386d7d8666b2da45253a44dd33ad2afe5c9c8bd6c7263aec19248d80294d6bcfe2b044a0301e54d95c12e22b52d162edbf8347fd4ae18d090b"

  private val localState =
    "00030002000138d4842a57c0c60dc7f1fdcea9d8fedab4f636e6978c5994e88e47ead073eb03003801b18751f7763d94556d9c4ac8f9b6e6a25803513cfdcbd5df16b4f4ab1b06c02009bb7673e02e67130e910ce086368b36ed6ae42b6fb704010000000000000000000000000100000000000000000000000001000000000000000000000000020001000000000000000000000001200000000000000000"

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
    for {
      state <- ledger.zswapChainStateNew().toOption
      guaranteedCoins <- ledger.extractGuaranteedCoinsFromTransaction(validTx).toOption
      updatedState <- ledger.zswapChainStateTryApply(state.data, guaranteedCoins.data).toOption
    } yield assert(updatedState.data.nonEmpty)
  }

  test("Extracting merkle tree root should work") {
    val state = ledger.zswapChainStateNew().toOption.get.data
    val root = ledger.zswapChainStateMerkleTreeRoot(state).toOption.get

    assertEquals(root.data, "00")
  }

  test("Extracting guaranteed coins from transaction should work") {
    assert(ledger.extractGuaranteedCoinsFromTransaction(validTx).isRight)
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
