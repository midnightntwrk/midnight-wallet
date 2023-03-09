package io.iohk.midnight.wallet.engine.js

import cats.effect.Resource
import cats.effect.kernel.Async
import cats.syntax.eq.*
import cats.syntax.functor.*
import io.iohk.midnight.midnightMockedNodeApi.anon.Hash
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction
import io.iohk.midnight.midnightMockedNodeApi.distDataTxSubmissionResultMod.{
  TxRejected,
  TxSubmissionResult,
}
import io.iohk.midnight.midnightMockedNodeApi.distMockedNodeMod.MockedNode
import io.iohk.midnight.midnightMockedNodeApi.mod.TRANSACTION_ACCEPTED
import io.iohk.midnight.midnightMockedNodeClient.*
import io.iohk.midnight.pino.mod.pino.LoggerOptions
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import sttp.model.Uri

import scala.scalajs.js
import scala.scalajs.js.Promise

object TxSubmissionServiceFactory {

  // Ugly code, will be simplified by using TestSystem from mocked-node
  // https://input-output.atlassian.net/browse/PM-5758
  def fromNode[F[_]: Async](node: MockedNode[Transaction]): TxSubmissionService[F] =
    doSubmitTransaction(node.submitTx)

  def fromMockedNodeClient[F[_]: Async](nodeUri: Uri): Resource[F, TxSubmissionService[F]] = {
    // This logger needs to be adjusted to the existing tracing solutions.
    // https://input-output.atlassian.net/browse/PM-5761
    val pinoLogger = io.iohk.midnight.pino.mod.default.apply[LoggerOptions]()
    val clientF = Async[F].fromPromise(Async[F].delay(mod.client(nodeUri.toString(), pinoLogger)))
    val clientR = Resource.make(clientF)(client => Async[F].delay(client.close()))

    clientR.map { client => doSubmitTransaction(client.submitTx) }
  }

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def doSubmitTransaction[F[_]: Async](
      submitMethod: Transaction => Promise[TxSubmissionResult],
  ): TxSubmissionService[F] = { transaction: data.Transaction =>
    val nodeTx = Transaction(transaction.body, Hash(transaction.header.hash.value))
    Async[F].fromPromise(Async[F].delay(submitMethod(nodeTx))).map { result =>
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
