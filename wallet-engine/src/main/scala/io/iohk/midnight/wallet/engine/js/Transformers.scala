package io.iohk.midnight.wallet.engine.js

import cats.syntax.apply.*
import cats.syntax.flatMap.*
import cats.syntax.functor.*
import cats.syntax.traverse.*
import cats.{ApplicativeThrow, MonadThrow}
import io.circe
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ArbitraryJson
import typings.midnightWalletApi.contractMod.Contract
import typings.midnightWalletApi.transactionMod.{CALL_TX, DEPLOY_TX}
import typings.midnightWalletApi.oraclesMod.Oracle
import typings.midnightWalletApi.transactionMod.{CallTransaction, DeployTransaction, Transaction}
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
        transformContract(deployTx.contract),
        deployTx.hash.value,
        new Date(deployTx.timestamp.toEpochMilli.toDouble),
        deployTx.transitionFunctionCircuits.value.toJSArray,
        DEPLOY_TX,
      )

    private def transformContract(contract: data.Contract): Contract =
      (
        contract.publicOracle.map(transformOracle),
        contract.privateOracle.map(transformOracle),
      ) match {
        case (Some(publicOracle), Some(privateOracle)) =>
          Contract().setPrivateOracle(privateOracle).setPublicOracle(publicOracle)
        case (Some(publicOracle), None)  => Contract().setPublicOracle(publicOracle)
        case (None, Some(privateOracle)) => Contract().setPrivateOracle(privateOracle)
        case (None, None)                => Contract()
      }

    private def transformOracle(oracle: data.Oracle): Oracle =
      Oracle(transformTranscript(oracle.transcript))
  }

  object ApiToData {
    def transformContract[F[_]: MonadThrow](contract: Contract): F[data.Contract] =
      (
        contract.publicOracle.toOption
          .map(_.transcript)
          .traverse(transformTranscript[F])
          .map(_.map(data.Oracle)),
        contract.privateOracle.toOption
          .map(_.transcript)
          .traverse(transformTranscript[F])
          .map(_.map(data.Oracle)),
      ).mapN(data.Contract)

    def transformTranscript[F[_]: MonadThrow](transcript: Transcript): F[data.Transcript] =
      transcript.toSeq.traverse(transformQuery[F]).map(data.Transcript)

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
