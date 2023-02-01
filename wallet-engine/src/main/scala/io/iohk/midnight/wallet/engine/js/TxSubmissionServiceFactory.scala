package io.iohk.midnight.wallet.engine.js

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.eq.*
import cats.syntax.functor.*
import io.iohk.midnight.midnightMockedNodeApi.anon.Hash
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction
import io.iohk.midnight.midnightMockedNodeApi.distDataTxSubmissionResultMod.TxRejected
import io.iohk.midnight.midnightMockedNodeApi.distMockedNodeMod.MockedNode
import io.iohk.midnight.midnightMockedNodeApi.mod.TRANSACTION_ACCEPTED
import io.iohk.midnight.tracer.Tracer
import io.iohk.midnight.tracer.logging.StructuredLog
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.Instances.*
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.ouroboros.network.{
  JsonWebSocketClientTracer,
  SttpJsonWebSocketClient,
}
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService
import io.iohk.midnight.wallet.ouroboros.tx_submission.OuroborosTxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.ouroboros.tx_submission.tracing.OuroborosTxSubmissionTracer
import scala.scalajs.js
import sttp.client3.impl.cats.FetchCatsBackend
import sttp.model.Uri

object TxSubmissionServiceFactory {
  // Ugly code, will be simplified by using Ouroboros client from mocked-node
  // https://input-output.atlassian.net/browse/PM-5537
  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def fromNode[F[_]: Async](node: MockedNode[Transaction]): TxSubmissionService[F] =
    new TxSubmissionService[F] {
      override def submitTransaction(
          transaction: data.Transaction,
      ): F[TxSubmissionService.SubmissionResult] = {
        val nodeTx = Transaction(transaction.body, Hash(transaction.header.hash.value))
        Async[F].fromPromise(Async[F].delay(node.submitTx(nodeTx))).map { result =>
          val tag = result.asInstanceOf[js.Dynamic].tag.asInstanceOf[String]
          if (tag === TRANSACTION_ACCEPTED) {
            TxSubmissionService.SubmissionResult.Accepted
          } else {
            val reason = result.asInstanceOf[TxRejected].reason
            TxSubmissionService.SubmissionResult.Rejected(reason)
          }
        }
      }
    }

  def connect[F[_]: Async](
      nodeUri: Uri,
      rootTracer: Tracer[F, StructuredLog],
  ): Resource[F, TxSubmissionService[F]] = {
    implicit val jsonWebSocketClientTracer: JsonWebSocketClientTracer[F] =
      JsonWebSocketClientTracer.from(rootTracer)
    implicit val ouroborosTxSubmissionTracer: OuroborosTxSubmissionTracer[F] =
      OuroborosTxSubmissionTracer.from(rootTracer)
    val sttpBackend = FetchCatsBackend[F]()

    SttpJsonWebSocketClient[F](sttpBackend, nodeUri)
      .flatMap(OuroborosTxSubmissionService[F, data.Transaction](_))
      .map { ouroborosSubmitTxService =>
        new TxSubmissionService[F] {
          override def submitTransaction(
              transaction: data.Transaction,
          ): F[TxSubmissionService.SubmissionResult] = {
            ouroborosSubmitTxService.submitTransaction(transaction).map {
              case SubmissionResult.Accepted =>
                TxSubmissionService.SubmissionResult.Accepted
              case SubmissionResult.Rejected(reason) =>
                TxSubmissionService.SubmissionResult.Rejected(reason)
            }
          }
        }
      }
  }
}
