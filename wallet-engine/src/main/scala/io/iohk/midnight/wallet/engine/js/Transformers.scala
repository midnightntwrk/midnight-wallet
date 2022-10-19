package io.iohk.midnight.wallet.engine.js

import cats.syntax.all.*
import cats.{ApplicativeThrow, MonadThrow}
import io.circe
import io.iohk.midnight.wallet.blockchain.data
import io.iohk.midnight.wallet.blockchain.data.ArbitraryJson
import scala.scalajs.js
import scala.scalajs.js.JSConverters.JSRichIterableOnce
import scala.scalajs.js.JSON
import typings.midnightWalletApi.transactionMod.{Transaction, TransactionHeader}

object Transformers {
  object DataToApi {
    def transformTransaction(tx: data.Transaction): Transaction =
      Transaction(dynamicFromJson(tx.body.value), TransactionHeader(tx.header.hash.value))

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
  }

  object ApiToData {
    def transformTransaction[F[_]: MonadThrow](tx: Transaction): F[data.Transaction] =
      buildArbitraryJson(tx.body).map(data.Transaction(transformTransactionHeader(tx), _))

    private def buildArbitraryJson[F[_]: MonadThrow](obj: Any): F[ArbitraryJson] =
      stringify(obj).flatMap(ArbitraryJson.parse[F])

    @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
    private def stringify[F[_]: ApplicativeThrow](obj: Any): F[String] =
      ApplicativeThrow[F]
        .catchNonFatal(JSON.stringify(obj.asInstanceOf[js.Any]))

    private def transformTransactionHeader(
        tx: Transaction,
    ): data.Transaction.Header =
      data.Transaction.Header(data.Hash(tx.header.hash))
  }
}
