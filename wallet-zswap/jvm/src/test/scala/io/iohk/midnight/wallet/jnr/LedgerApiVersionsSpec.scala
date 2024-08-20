package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import cats.syntax.all.*
import munit.ScalaCheckSuite

@SuppressWarnings(Array("org.wartremover.warts.ToString", "org.wartremover.warts.OptionPartial"))
class LedgerApiVersionsSpec extends ScalaCheckSuite {

  override def munitIgnore: Boolean = scala.util.Properties.isMac

  private val hexedEncryptionSecretKeyV1 =
    "000300386d7d8666b2da45253a44dd33ad2afe5c9c8bd6c7263aec19248d80294d6bcfe2b044a0301e54d95c12e22b52d162edbf8347fd4ae18d090b"

  private val hexedEncryptionSecretKeyV2 =
    "010000206cbc420407d0c7eaaa2ef4f7a622440bf37773cd7f08f3107d16f2be060c1505"

  private lazy val ledgerV1 =
    LedgerLoader
      .loadLedger(Some(NetworkId.Undeployed), ProtocolVersion.V1)
      .fold(fail("Invalid ledger state", _), identity)

  private lazy val ledgerV2 =
    LedgerLoader
      .loadLedger(Some(NetworkId.Undeployed), ProtocolVersion.V2)
      .fold(fail("Invalid ledger state", _), identity)

  private def failWithErrors(errors: NonEmptyList[JNRError]): Nothing =
    fail(errors.map(_.toString).toList.mkString("\n"))

  test("Validating valid viewing key should succeed") {
    ledgerV1.tryDeserializeEncryptionKey(hexedEncryptionSecretKeyV1) match {
      case Left(errors)             => failWithErrors(errors)
      case Right(StringResult(key)) => assert(key.nonEmpty)
    }
    ledgerV2.tryDeserializeEncryptionKey(hexedEncryptionSecretKeyV2) match {
      case Left(errors)             => failWithErrors(errors)
      case Right(StringResult(key)) => assert(key.nonEmpty)
    }
  }

  test("Validating invalid viewing key should fail") {
    ledgerV1.tryDeserializeEncryptionKey(hexedEncryptionSecretKeyV2) match {
      case Left(errors) =>
        assert(errors.toList.contains(LedgerErrorResult(LedgerError.EncryptionSecretKeyError)))
      case Right(_) =>
        fail("Invalid viewing key returned valid")
    }
    ledgerV2.tryDeserializeEncryptionKey(hexedEncryptionSecretKeyV1) match {
      case Left(errors) =>
        assert(errors.toList.contains(LedgerErrorResult(LedgerError.EncryptionSecretKeyError)))
      case Right(_) =>
        fail("Invalid viewing key returned valid")
    }
  }
}
