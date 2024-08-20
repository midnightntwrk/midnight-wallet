package io.iohk.midnight.wallet.jnr

import cats.data.NonEmptyList
import cats.effect.{IO, Resource}
import io.iohk.midnight.wallet.jnr.LedgerV1.*
import munit.{CatsEffectSuite, ScalaCheckSuite}

import scala.io.{Codec, Source}

@SuppressWarnings(Array("org.wartremover.warts.ToString"))
class LedgerApiDevNetSpec extends CatsEffectSuite with ScalaCheckSuite {

  override def munitIgnore: Boolean = scala.util.Properties.isMac

  private val validDevNetTx =
    "01030000000000030000000000000000000000000000000000000000"

  test("Extracting guaranteed coins from DEV NET transaction should work") {
    val devNetLedger =
      LedgerLoader
        .loadLedger(networkId = Some(NetworkId.DevNet), ProtocolVersion.V1)
        .getOrElse(fail("Invalid ledger state"))

    assert(devNetLedger.extractGuaranteedCoinsFromTransaction(validDevNetTx).isRight)
  }

  test("Extracting guaranteed coins from wrong network transaction should NOT work") {
    val undeployedLedger =
      LedgerLoader
        .loadLedger(networkId = Some(NetworkId.Undeployed), ProtocolVersion.V1)
        .getOrElse(fail("Invalid ledger state"))

    undeployedLedger.extractGuaranteedCoinsFromTransaction(validDevNetTx) match {
      case Left(errors) =>
        assert(
          errors.toList
            .map(_.getMessage)
            .mkString
            .contains("Ledger error code 8"),
        )
      case Right(_) => fail("Should not be here!")
    }
  }

  // FIXME: In order to get a valid state one has to run the system so this test can't be updated
  test("Contract zswap chain state can be derived from local ledger state (zswap)".ignore) {
    val devNetLedger =
      LedgerLoader
        .loadLedger(networkId = Some(NetworkId.DevNet), ProtocolVersion.V1)
        .getOrElse(fail("Invalid ledger state"))

    val testR = for {
      ledgerState <- getFileContent("ledger_state_devnet.txt")
      expectedZSwapChainState <- getFileContent("expected_zswap_chain_state.txt")
    } yield devNetLedger.zswapChainStateFilter(
      zswapChainState = ledgerState,
      contractAddress = "010001f2b1e1b25d787c9b208fb6155ffd3992a55bee88468864c7f5bc46bb2a64546e",
    ) match {
      case Left(errors)         => fail(errors.toList.map(_.getMessage).mkString(","))
      case Right(filteredState) => assertEquals(filteredState.data, expectedZSwapChainState)
    }

    testR.use_
  }

  private def getFileContent(fileName: String): Resource[IO, String] = {
    val readFileF =
      IO(Source.fromURL(getClass.getClassLoader.getResource(s"$fileName"), Codec.UTF8.name))
    Resource
      .make(readFileF)(f => IO(f.close()))
      .map(_.getLines().toSeq.mkString(System.lineSeparator()))
  }
}
