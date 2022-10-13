package io.iohk.midnight.wallet.engine.js

import cats.syntax.apply.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import cats.syntax.traverse.*
import cats.{ApplicativeThrow, MonadThrow}
import io.circe
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.{ArbitraryJson, PublicOracle}
import typings.midnightWalletApi.transactionMod.{
  CALL_TX,
  CallTransaction,
  DEPLOY_TX,
  DeployTransaction,
  Transaction,
}
import typings.midnightWalletApi.transcriptMod.{Query, Transcript}
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce
import scala.scalajs.js.{Date, JSON}

object Transformers {
  object DataToApi {
    def transformTransaction(tx: data.Transaction): Transaction =
      tx match {
        case callTx: data.CallTransaction     => transformCallTransaction(callTx)
        case deployTx: data.DeployTransaction => transformDeployTransaction(deployTx)
      }

    private def transformCallTransaction(callTx: data.CallTransaction): CallTransaction =
      CallTransaction(
        callTx.address.value,
        callTx.functionName.value,
        callTx.hash.value,
        callTx.nonce.value,
        callTx.proof.value,
        transformTranscript(callTx.publicTranscript),
        new Date(callTx.timestamp.toEpochMilli.toDouble),
        CALL_TX,
      )

    private def transformTranscript(transcript: data.Transcript): Transcript =
      transcript.value.map(transformQuery).toJSArray

    private def transformQuery(query: data.Query): Query =
      Query(
        dynamicFromJson(query.arg.value),
        query.functionName.value,
        dynamicFromJson(query.result.value),
      )

    @SuppressWarnings(
      Array(
        "org.wartremover.warts.Null",
        "org.wartremover.warts.Recursion",
        "MethodReturningAny",
        "NullParameter",
      ),
    )
    private def dynamicFromJson(json: circe.Json): Any =
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

    private def transformDeployTransaction(
        deployTx: data.DeployTransaction,
    ): DeployTransaction =
      DeployTransaction(
        deployTx.hash.value,
        dynamicFromJson(deployTx.publicOracle.arbitraryJson.value),
        new Date(deployTx.timestamp.toEpochMilli.toDouble),
        deployTx.transitionFunctionCircuits.value.toJSArray,
        DEPLOY_TX,
      )
  }

  object ApiToData {
    def transformTranscript[F[_]: MonadThrow](transcript: Transcript): F[data.Transcript] =
      transcript.toSeq.traverse(transformQuery[F]).map(data.Transcript)

    def transformPublicOracle[F[_]: MonadThrow](publicOracle: Any): F[data.PublicOracle] =
      buildArbitraryJson(publicOracle).map(PublicOracle)

    private def transformQuery[F[_]: MonadThrow](query: Query): F[data.Query] =
      (buildArbitraryJson(query.argument), buildArbitraryJson(query.result))
        .mapN(data.Query(data.FunctionName(query.functionName), _, _))

    private def buildArbitraryJson[F[_]: MonadThrow](obj: Any): F[ArbitraryJson] =
      stringify(obj).flatMap(ArbitraryJson.parse[F])

    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    private def stringify[F[_]: ApplicativeThrow](obj: Any): F[String] =
      ApplicativeThrow[F]
        .catchNonFatal(JSON.stringify(obj.asInstanceOf[js.Any]))
  }
}
