package io.iohk.midnight.wallet.engine.js

import cats.effect.kernel.{Async, Resource}
import cats.syntax.functor.*
import io.iohk.midnight.wallet.zswap.{NetworkId, Transaction}
import io.iohk.midnight.wallet.core.services.TxSubmissionService
import io.iohk.midnight.wallet.core.services.TxSubmissionService.SubmissionResult
import io.iohk.midnight.wallet.substrate.*
import sttp.model.Uri

object TxSubmissionServiceFactory {

  def apply[F[_]: Async](
      substrateNodeUri: Uri,
  )(using networkId: NetworkId): Resource[F, TxSubmissionService[F]] = {
    SubstrateClient(substrateNodeUri).map { client => (transaction: Transaction) =>
      {
        client.submitTransaction(SubmitTransactionRequest(transaction.toJs, networkId.toJs)).map {
          case SubmitTransactionResponse(result) =>
            result match
              case RpcError(_, message, _) => SubmissionResult.Rejected(message)
              case _                       => SubmissionResult.Accepted
        }
      }
    }
  }

}
