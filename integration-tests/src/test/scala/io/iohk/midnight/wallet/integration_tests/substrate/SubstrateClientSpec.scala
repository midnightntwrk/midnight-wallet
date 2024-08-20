package io.iohk.midnight.wallet.integration_tests.substrate

import cats.effect.IO
import cats.effect.IO.asyncForIO
import io.iohk.midnight.midnightNtwrkZswap.mod.NetworkId
import io.iohk.midnight.wallet.substrate.TransactionExamples.transaction
import io.iohk.midnight.wallet.substrate.*
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.model.Uri

class SubstrateClientSpec extends CatsEffectSuite {

  private val serverUri: Uri = uri"http://localhost:9933"

  private def withSubstrateClient(body: SubstrateClient[IO] => IO[Unit]): IO[Unit] =
    SubstrateClient(serverUri).use(body(_))

  test("Substrate client must submit transaction to the node and return ExtrinsicsHash".ignore) {
    withSubstrateClient { substrateClient =>
      substrateClient
        .submitTransaction(SubmitTransactionRequest(transaction, NetworkId.Undeployed))
        .map { case SubmitTransactionResponse(result) =>
          result match
            case _: ExtrinsicsHash =>
            case _                 => fail("Valid submit tx must return hash")

        }
    }
  }
}
