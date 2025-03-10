package io.iohk.midnight.wallet.indexer

import sttp.client3.{UriContext, asStringAlways, emptyRequest}
import sttp.model.Uri
import scala.scalajs.js
import cats.effect.*

object LegacyIndexerCheck {
  @SuppressWarnings(Array("org.wartremover.warts.AsInstanceOf"))
  def check(indexerUri: Uri): IO[Boolean] = {
    val host = indexerUri.host.getOrElse("")
    val scheme = indexerUri.scheme.fold("")(scheme => s"$scheme://")
    val port = indexerUri.port.fold("")(port => s":$port")
    val statusUri = s"$scheme$host$port/status"

    SttpBackendFactory.build.use { backend =>
      val request = emptyRequest.get(uri"$statusUri").response(asStringAlways)

      backend
        .send(request)
        .map(response => {
          val json = js.JSON.parse(response.body)
          val version = json.version.asInstanceOf[String]
          isVersionGreaterThanOrEqual(version, "2.3.0")
        })
        .handleErrorWith(_ => IO.pure(false))
    }
  }

  def isVersionGreaterThanOrEqual(version: String, minVersion: String): Boolean = {
    val versionParts = version.split('.').map(_.toInt)
    val minVersionParts = minVersion.split('.').map(_.toInt)
    val pairs = versionParts.zipAll(minVersionParts, 0, 0)

    pairs.find { case (v, mv) => v != mv } match {
      case Some((v, mv)) => v > mv
      case None          => true
    }
  }
}
