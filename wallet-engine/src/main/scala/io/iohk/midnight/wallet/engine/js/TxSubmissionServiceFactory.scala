package io.iohk.midnight.wallet.engine.js

import cats.effect.kernel.{Async, Resource}
import cats.syntax.eq.*
import cats.syntax.functor.*
import io.iohk.midnight.midnightMockedNodeApi.anon.Hash
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction
import io.iohk.midnight.midnightMockedNodeApi.distDataTxSubmissionResultMod.{
  TxRejected,
  TxSubmissionResult,
}
import io.iohk.midnight.midnightMockedNodeApi.mod.TRANSACTION_ACCEPTED
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.engine.config.NodeConnectionResourced

import scala.scalajs.js
import scala.scalajs.js.Promise

object TxSubmissionServiceFactory {

  def apply[F[_]: Async](
      nodeConnectionResourced: NodeConnectionResourced,
  ): Resource[F, TxSubmissionService[F]] =
    nodeConnectionResourced.submitSessionResource.map(session =>
      doSubmitTransaction(session.submitTx),
    )

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  private def doSubmitTransaction[F[_]: Async](
      submitMethod: Transaction => Promise[TxSubmissionResult],
  ): TxSubmissionService[F] = { transaction: data.Transaction =>
    val nodeTx = Transaction(transaction.body, Hash(transaction.header.hash.value))
    Async[F].fromPromise(Async[F].delay(submitMethod(nodeTx))).map { result =>
      val tag = result.asInstanceOf[js.Dynamic].tag.asInstanceOf[String]
      if (tag === TRANSACTION_ACCEPTED) {
        TxSubmissionService.SubmissionResult.Accepted
        // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
      } else {
        val reason = result.asInstanceOf[TxRejected].reason
        TxSubmissionService.SubmissionResult.Rejected(reason)
      }
    // $COVERAGE-ON$
    }
  }
}
