package io.iohk.midnight.wallet.substrate

import cats.effect.IO
import cats.effect.IO.asyncForIO
import munit.CatsEffectSuite
import sttp.client3.UriContext
import sttp.model.Uri

import io.iohk.midnight.wallet.substrate.TransactionExamples.transaction

class SubstrateClientSpec extends CatsEffectSuite {

  private val serverUri: Uri = uri"http://localhost:9933"

  private def withSubstrateClient(
      body: SubstrateClient[IO] => IO[Unit],
  ): IO[Unit] =
    SubstrateClient(serverUri)
      .use(body(_))

  test("Substrate client must submit transaction to the node and return ExtrinsicsHash".ignore) {
    withSubstrateClient { substrateClient =>
      substrateClient.submitTransaction(SubmitTransactionRequest(transaction)).map {
        case SubmitTransactionResponse(result) =>
          result match
            case ExtrinsicsHash(hash) =>
            case _                    => fail("Valid submit tx must return hash")

      }
    }
  }
}
