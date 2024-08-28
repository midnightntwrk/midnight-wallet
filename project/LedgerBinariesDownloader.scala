import cats.effect.IO
import cats.effect.kernel.Resource
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.*
import io.circe.generic.semiauto.*
import sbt.internal.util.ManagedLogger
import sttp.client3.circe.asJson
import sttp.client3.{
  FollowRedirectsBackend,
  HttpClientSyncBackend,
  SimpleHttpClient,
  UriContext,
  asFile,
  basicRequest,
}
import sttp.model.Uri.QuerySegmentEncoding

import java.io.{File, PrintWriter}
import java.nio.file.Paths
import java.time.Instant
import scala.io.Source
import scala.sys.process.Process
import scala.util.Try

object LedgerBinariesDownloader {

  final case class Config(
      ghAuthToken: String,
      tempDir: String,
      resourcesDir: String,
      requiredAssets: List[AssetType],
      releaseTag: String,
      logger: ManagedLogger,
      versionAlias: String,
  )

  sealed abstract class AssetType(val name: String)
  case object Linux extends AssetType("linux")
  case object Darwin extends AssetType("darwin")

  object AssetType {
    def fromName(name: String): Option[AssetType] =
      if (name.contains(Darwin.name)) {
        Some(Darwin)
      } else if (name.contains(Linux.name)) {
        Some(Linux)
      } else None
  }

  def downloadBinaries(config: Config): Unit = {
    shouldDownload(config)
      .flatMap {
        case true =>
          for {
            client <- downloader.createHttpClient
            releases <- Resource.eval(downloader.downloadReleasesInfo(client, config))
            _ <- Resource.eval(processReleases(client, releases, config))
            _ <- saveArchiveInfo(config)
          } yield ()
        case false => Resource.unit
      }
      .allocated
      .flatMap { case (_, finalizers) => finalizers }
      .unsafeRunSync()
  }

  private def archiveInfoFilePath(config: Config) =
    Paths.get(s"${config.resourcesDir}/archive_info.txt")

  object models {
    final case class Release(
        id: Long,
        tag_name: String,
        published_at: Instant,
        created_at: Instant,
        assets: List[Asset],
    ) {
      def containsAllRequiredAssets(requiredAssets: List[AssetType]): Boolean =
        assets.nonEmpty && assets.map(_.`type`).forall(requiredAssets.contains)
    }

    object Release {
      implicit val releaseDecoder: Decoder[Release] = deriveDecoder
    }

    final case class Asset(id: Long, name: String, browserDownloadUrl: String, `type`: AssetType)

    object Asset {
      implicit val assetDecoder: Decoder[Asset] = (c: HCursor) => {
        for {
          id <- c.get[Long]("id")
          name <- c.get[String]("name")
          browserDownloadUrl <- c.get[String]("browser_download_url")
        } yield AssetType.fromName(name) match {
          case Some(assetType) => Asset(id, name, browserDownloadUrl, assetType)
          case None => throw new IllegalStateException(s"Unexpected asset type received: $name")
        }
      }
    }
  }

  object downloader {
    def createHttpClient: Resource[IO, SimpleHttpClient] = {
      val backend = new FollowRedirectsBackend(
        delegate = HttpClientSyncBackend(),
        transformUri = _.querySegmentsEncoding(QuerySegmentEncoding.All),
      )

      Resource.make(IO.pure(SimpleHttpClient(backend)))(client => IO.pure(client.close()))
    }

    def downloadReleasesInfo(
        client: SimpleHttpClient,
        config: Config,
    ): IO[List[models.Release]] = {
      val uri =
        uri"https://api.github.com/repos/input-output-hk/midnight-ledger-prototype/releases"
      val req = basicRequest.auth
        .bearer(config.ghAuthToken)
        .header("Application", "vnd.github+json")
        .get(uri)
        .response(asJson[List[models.Release]])

      IO.fromTry(Try(client.send(req).body))
        .flatTap(_ => logMessage(config, s"Downloading GH Ledger [${config.releaseTag}] JNR releases..."))
        .flatMap {
          case Left(error) =>
            logMessage(config, s"Can't download GH releases: $error") >>
              IO.raiseError(new IllegalStateException(error))
          case Right(releases) => IO.pure(releases)
        }
    }

    def downloadAsset(
        config: Config,
        client: SimpleHttpClient,
        asset: models.Asset,
    ): IO[File] = {
      val path = Paths.get(s"${config.tempDir}/${asset.name}")
      val assetUri =
        uri"https://api.github.com/repos/input-output-hk/midnight-ledger-prototype/releases/assets/${asset.id}"

      val downloadRequest = basicRequest
        .followRedirects(true)
        .auth
        .bearer(config.ghAuthToken)
        .header("Accept", "application/octet-stream")
        .get(assetUri)
        .response(asFile(path.toFile))

      IO.fromTry(Try(client.send(downloadRequest).body))
        .flatTap(_ => logMessage(config, s"Downloading JNR asset: ${asset.name}"))
        .flatMap {
          case Left(error)                => IO.raiseError(new IllegalStateException(error))
          case Right(downloadedAssetFile) => IO.pure(downloadedAssetFile)
        }
    }
  }

  private def saveArchiveInfo(config: Config): Resource[IO, Unit] = {
    Resource
      .make(IO(new PrintWriter(archiveInfoFilePath(config).toFile)))(writer => IO(writer.close()))
      .evalMap { infoFile =>
        IO {
          infoFile.write("")
          infoFile.write(s"${config.releaseTag}")
        }
      }
  }

  private def readArchiveInfo(config: Config): Resource[IO, Option[String]] = {
    val infoFile = archiveInfoFilePath(config).toFile

    if (infoFile.exists()) {
      Resource
        .make(IO(Source.fromFile(infoFile)))(source => IO(source.close()))
        .evalMap { infoFile => IO(infoFile.getLines().toList.headOption) }
    } else {
      Resource.pure(None)
    }
  }

  private def shouldDownload(config: Config): Resource[IO, Boolean] =
    readArchiveInfo(config).map(!_.contains(config.releaseTag))

  private def extractAndSaveAsset(downloadedFile: File, config: Config): IO[Unit] = {
    val targetDir = s"${config.resourcesDir}/${downloadedFile.getName.takeWhile(_ != '.')}"
    val mkdirCommand = s"mkdir -p $targetDir"
    val tarCommand = s"tar -xzf ${downloadedFile.getPath} " +
      s"--transform=s|libmidnight_zswap_c_bindings.so|libmidnight_zswap_c_bindings_${config.versionAlias}.so| " +
      s"--transform=s|libmidnight_zswap_c_bindings.dylib|libmidnight_zswap_c_bindings_${config.versionAlias}.dylib| " +
      s"--strip-components=2 -C $targetDir"

    IO.fromTry(Try(Process(mkdirCommand).!!)) >>
      IO.fromTry(Try(Process(tarCommand).!!))
        .attempt
        .handleErrorWith { tarError =>
          val message = s"TAR command failed with: ${tarError.getMessage}"
          logMessage(config, message) >> IO.raiseError(new IllegalStateException(message))
        } >> logMessage(config, s"Extracted ${downloadedFile.getName} into $targetDir")
  }

  private def processReleases(
      client: SimpleHttpClient,
      releases: List[models.Release],
      config: Config,
  ): IO[Unit] = {
    releases.find(_.tag_name === config.releaseTag) match {
      case Some(release) if release.containsAllRequiredAssets(config.requiredAssets) =>
        release.assets
          .traverse { asset =>
            downloader
              .downloadAsset(config, client, asset)
              .flatMap(extractAndSaveAsset(_, config))
          }
          .as(())

      case Some(release) =>
        val message =
          s"Release does not have all required assets (${config.requiredAssets.mkString(",")})."
        logMessage(config, message) >> IO.raiseError(new IllegalStateException(message))
      case None =>
        val message = s"Can't find release for ${config.releaseTag} tag."
        logMessage(config, message) >> IO.raiseError(new IllegalStateException(message))
    }
  }

  private def logMessage(config: Config, message: String): IO[Unit] = {
    IO(config.logger.info(message))
  }
}
