package io.iohk.midnight.wallet.engine.js
import cats.effect.IO
import cats.effect.unsafe.implicits.global
import cats.syntax.either.*
import cats.syntax.eq.*
import io.iohk.midnight.midnightMockedNodeApi.distDataBlockMod.Block
import io.iohk.midnight.midnightMockedNodeApi.distDataRequestNextResultMod.RequestNextResult
import io.iohk.midnight.midnightMockedNodeApi.distDataTransactionMod.Transaction as ApiTransaction
import io.iohk.midnight.midnightMockedNodeApi.distDataTxSubmissionResultMod
import io.iohk.midnight.midnightMockedNodeClient.distMockedNodeClientMod.client
import io.iohk.midnight.pino.mod.LoggerOptions
import io.iohk.midnight.rxjs.mod.*
import sttp.model.Uri

import scala.scalajs.js
import scala.scalajs.js.Promise

object NodeConnectionFactory {

  private val pinoLogger = io.iohk.midnight.pino.mod.default.apply[LoggerOptions]()

  final case class InvalidUri(msg: String) extends Throwable(msg)

  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def create(rawUri: String): Either[InvalidUri, NodeConnection] = {
    Uri.parse(rawUri).leftMap(InvalidUri).map { nodeUri =>
      // $COVERAGE-OFF$ TODO: [PM-5832] Improve code coverage
      new NodeConnection {
        override def startSyncSession(): js.Promise[SyncSession] =
          IO.fromFuture(IO(client(nodeUri.toString(), pinoLogger).toFuture))
            .map { mockedNodeClient =>
              new SyncSession {
                override def sync(): Observable_[Block[ApiTransaction]] = {
                  val filterFun = {
                    (requestNextResult: RequestNextResult[Block[ApiTransaction]], _: Double) =>
                      {
                        val tag =
                          requestNextResult.asInstanceOf[js.Dynamic].tag.asInstanceOf[String]
                        tag === "RollForward"
                      }
                  }

                  val mapFun = {
                    (requestNextResult: RequestNextResult[Block[ApiTransaction]], _: Double) =>
                      {
                        requestNextResult
                          .asInstanceOf[js.Dynamic]
                          .block
                          .asInstanceOf[Block[ApiTransaction]]
                      }
                  }

                  mockedNodeClient
                    .sync()
                    .pipe(filter(filterFun), map(mapFun))
                    .asInstanceOf[Observable_[Block[ApiTransaction]]]
                }

                override def close(): Unit =
                  mockedNodeClient.close()
              }
            }
            .unsafeToPromise()

        override def startSubmitSession(): js.Promise[SubmitSession] =
          IO.fromFuture(IO(client(nodeUri.toString(), pinoLogger).toFuture))
            .map { mockedNodeClient =>
              new SubmitSession {
                override def submitTx(tx: ApiTransaction)
                    : Promise[distDataTxSubmissionResultMod.TxSubmissionResult] =
                  mockedNodeClient.submitTx(tx)

                override def close(): Unit =
                  mockedNodeClient.close()
              }
            }
            .unsafeToPromise()
      }
      // $COVERAGE-ON$
    }
  }
}
