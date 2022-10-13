package io.iohk.midnight.wallet.ogmios.sync

import cats.syntax.show.*
import io.circe
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.util.implicits.ShowInstances.instantShow
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce
import typings.midnightMockedNodeApi.blockMod.{Block, BlockBody, BlockHeader}
import typings.midnightMockedNodeApi.queryMod.Query
import typings.midnightMockedNodeApi.transactionMod.*
import typings.midnightMockedNodeApi.transcriptMod.Transcript

private object Transformer {
  def transformBlock(block: data.Block): Block[Transaction] =
    Block(transformBlockBody(block.body), transformBlockHeader(block.header))

  private def transformBlockBody(body: data.Block.Body): BlockBody[Transaction] =
    BlockBody(body.transactionResults.map(transformTx).toJSArray)

  private def transformTx(tx: data.Transaction): Transaction =
    tx match {
      case callTx: data.CallTransaction     => transformCallTx(callTx)
      case deployTx: data.DeployTransaction => transformDeployTx(deployTx)
    }

  private def transformCallTx(tx: data.CallTransaction): CallTransaction =
    CallTransaction(
      tx.address.value,
      tx.functionName.value,
      tx.hash.value,
      tx.nonce.value,
      tx.proof.value,
      transformTranscript(tx.publicTranscript),
      tx.timestamp.show,
      CALL_TX,
    )

  private def transformTranscript(transcript: data.Transcript): Transcript =
    transcript.value.map(transformQuery).toJSArray

  private def transformQuery(q: data.Query): Query =
    Query(dynamicFromJson(q.arg.value), q.functionName.value, dynamicFromJson(q.result.value))

  @SuppressWarnings(
    Array(
      "org.wartremover.warts.Null",
      "org.wartremover.warts.Recursion",
      "MethodReturningAny",
      "NullParameter",
    ),
  )
  def dynamicFromJson(json: circe.Json): js.Any =
    json.fold[js.Any](
      jsonNull = null,
      jsonBoolean = identity,
      jsonNumber = _.toDouble,
      jsonString = identity,
      jsonArray = _.map(dynamicFromJson).toJSArray,
      jsonObject = { obj =>
        val mapped = obj.toList.map { case (key, json) => (key, dynamicFromJson(json)) }
        js.special.objectLiteral(mapped*)
      },
    )

  private def transformDeployTx(tx: data.DeployTransaction): DeployTransaction =
    DeployTransaction(
      tx.hash.value,
      dynamicFromJson(tx.publicOracle.arbitraryJson.value),
      tx.timestamp.show,
      tx.transitionFunctionCircuits.value.toJSArray,
      DEPLOY_TX,
    )

  private def transformBlockHeader(header: data.Block.Header): BlockHeader =
    BlockHeader(
      header.hash.value,
      header.height.value.toDouble,
      header.parentHash.value,
      new js.Date(header.timestamp.show),
    )
}
