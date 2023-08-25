import scala.sys.process._
import sbt.util.CacheImplicits._

Global / onChangedBuildSource := ReloadOnSourceChanges

lazy val warts = Warts.allBut(
  Wart.Any,
  Wart.DefaultArguments,
  Wart.ImplicitParameter,
  Wart.JavaSerializable,
  Wart.Nothing,
  Wart.Product,
  Wart.Recursion,
  Wart.Serializable,
)
lazy val nexus = "https://nexus.p42.at/repository"
lazy val repoUrl = taskKey[MavenRepository]("Repository for publishing")

val scala213 = "2.13.8"
val scala33 = "3.3.0"
val supportedScalaVersions = List(scala213, scala33)
val catsVersion = "2.9.0"
val catsEffectVersion = "3.4.5"
val circeVersion = "0.14.2"
val fs2Version = "3.4.0"
val log4CatsVersion = "2.4.0"
val midnightTracingVersion = "1.3.0"
val sttpClientVersion = "3.4.1"

lazy val nexusRepo =
  resolvers +=
    "Sonatype Nexus Repository Manager" at "https://nexus.p42.at/repository/maven-releases"
lazy val nexusCredentials =
  credentials += Credentials(
    "Sonatype Nexus Repository Manager",
    "nexus.p42.at",
    sys.env("MIDNIGHT_REPO_USER"),
    sys.env("MIDNIGHT_REPO_PASS"),
  )

lazy val commonSettings = Seq(
  // Scala compiler options
  scalaVersion := scala213,
  scalacOptions ~= { prev =>
    // Treat linting errors as warnings for quick development
    if (Env.devModeEnabled) prev.filterNot(_ == "-Xfatal-warnings") else prev
  },
  scalacOptions ++= {
    CrossVersion.partialVersion(scalaVersion.value) match {
      case Some((2, _)) => Seq("-Xsource:3") // Allow Scala 3 syntax like * wildcards for imports
      case _            => Seq.empty
    }
  },
  Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b"),

  // Private Nexus repository config
  nexusRepo,
  nexusCredentials,

  // Test dependencies
  libraryDependencies ++= Seq(
    "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
    "org.scalacheck" %%% "scalacheck" % "1.15.4",
    "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.1",
    "org.typelevel" %%% "scalacheck-effect-munit" % "1.0.3",
  ).map(_ % Test),

  // Linting
  wartremoverErrors ++= (if (Env.devModeEnabled) Seq.empty else warts),
  wartremoverWarnings ++= (if (Env.devModeEnabled) warts else Seq.empty),
  coverageFailOnMinimum := true,
  coverageMinimumStmtTotal := 100,
  coverageMinimumBranchTotal := 100,
)

lazy val useNodeModuleResolution = {
  import org.scalajs.jsenv.nodejs.NodeJSEnv
  jsEnv := new NodeJSEnv(
    NodeJSEnv
      .Config()
      .withArgs(List("--experimental-specifier-resolution=node")),
  )
}

val ghPackagesRealm = "GitHub Package Registry"
val ghPackagesHost = "maven.pkg.github.com"
val ghPackagesUrl = s"https://$ghPackagesHost/input-output-hk/midnight-wallet"
lazy val ghPackagesResolver =
  resolvers += ghPackagesRealm at ghPackagesUrl
lazy val ghPackagesCredentials =
  credentials += Credentials(
    ghPackagesRealm,
    ghPackagesHost,
    sys.env.getOrElse("MIDNIGHT_GH_USER", ""),
    sys.env.getOrElse("MIDNIGHT_PUBLISH_TOKEN", ""),
  )

lazy val commonPublishSettings = Seq(
  ghPackagesResolver,
  ghPackagesCredentials,
  organization := "io.iohk.midnight",
  version := "2.9.5",
  versionScheme := Some("early-semver"),
  publishTo := Some(ghPackagesRealm at ghPackagesUrl),
)

lazy val commonScalablyTypedSettings = Seq(
  externalNpm := {
    if (!Env.nixBuild) Process("yarn", baseDirectory.value).! else Seq.empty
    baseDirectory.value
  },
  stEnableScalaJsDefined := Selection.All,
  stOutputPackage := "io.iohk.midnight",
  Global / stQuiet := true,
)

lazy val blockchain = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("blockchain"))
  .settings(commonSettings)
  .settings(commonPublishSettings)
  .settings(
    name := "wallet-blockchain",
    crossScalaVersions := supportedScalaVersions,
    conflictWarning := ConflictWarning.disable,
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
    ),
    coverageExcludedPackages := "io.iohk.midnight.wallet.blockchain.*",
  )
  .jsSettings(
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },
  )

lazy val bloc = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("bloc"))
  .settings(commonSettings)
  .settings(
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "co.fs2" %%% "fs2-core" % fs2Version,
    ),
  )
  .jsSettings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    useNodeModuleResolution,
  )

lazy val walletCore = project
  .in(file("wallet-core"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(blockchain.js % "compile->compile;test->test")
  .dependsOn(jsInterop, bloc.js)
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },

    // Dependencies
    libraryDependencies ++= Seq(
      "com.softwaremill.sttp.client3" %%% "circe" % sttpClientVersion,
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      "co.fs2" %%% "fs2-core" % fs2Version,
      "io.circe" %%% "circe-generic-extras" % circeVersion,
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "org.typelevel" %%% "log4cats-core" % log4CatsVersion,
      "net.exoego" %%% "scala-js-nodejs-v16" % "0.14.0",
      "io.iohk.midnight" %%% "tracing-core" % midnightTracingVersion,
      "io.iohk.midnight" %%% "tracing-log" % midnightTracingVersion,
    ),

    // Test dependencies
    libraryDependencies += "org.typelevel" %%% "kittens" % "2.3.2" % Test,
    useNodeModuleResolution,

    // Coverage
    coverageExcludedPackages := "" +
      "io.iohk.midnight.wallet.core.WalletError.BadTransactionFormat;" +
      "io.iohk.midnight.wallet.core.Instances;",
  )

lazy val walletEngine = (project in file("wallet-engine"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(walletCore % "compile->compile;test->test")
  .configs(IntegrationTest)
  .settings(commonSettings, Defaults.itSettings)
  .settings(inConfig(IntegrationTest)(ScalaJSPlugin.testConfigSettings))
  .settings(commonScalablyTypedSettings)
  .settings(
    dist := distImpl.value,
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },

    // Test dependencies
    libraryDependencies ++= Seq(
      "org.http4s" %%% "http4s-dsl" % "0.23.11",
      "org.http4s" %%% "http4s-ember-server" % "0.23.11",
    ).map(_ % Test),
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
      // scalajs-test-bridge is not visible in IT context and needs to be explicitly added as dependency
      "org.scala-js" %% "scalajs-test-bridge" % "1.9.0",
    ).map(_ % IntegrationTest),

    // ScalablyTyped config
    stIgnore ++= List("cross-fetch", "isomorphic-ws", "ws", "fp-ts", "io-ts"),
    useNodeModuleResolution,

    // Coverage
    coverageExcludedPackages := "" +
      "io.iohk.midnight.wallet.engine.WalletBuilder;" +
      "io.iohk.midnight.wallet.engine.config;" +
      "io.iohk.midnight.wallet.engine.tracing.JsWalletTracer;" +
      "io.iohk.midnight.wallet.engine.tracing.JsWalletEvent.DefaultInstances;" +
      "io.iohk.midnight.wallet.engine.tracing.WalletBuilderEvent.DefaultInstances;" +
      "io.iohk.midnight.wallet.engine.tracing.WalletBuilderTracer;" +
      "io.iohk.midnight.wallet.engine.tracing.sync.SyncServiceTracer;" +
      "io.iohk.midnight.wallet.engine.js.SyncServiceFactory;",
  )

lazy val jsInterop = project
  .in(file("js-interop"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    crossScalaVersions := supportedScalaVersions,
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "co.fs2" %%% "fs2-core" % fs2Version,
    ),
    coverageExcludedPackages := "io.iohk.midnight.js.interop.util.ObservableOps",
  )

lazy val downloadLedgerBinaries = taskKey[File]("Download ledger binaries")
lazy val zswap = project
  .in(file("wallet-zswap"))
  .settings(
    downloadLedgerBinaries := {
      val store = streams.value.cacheStoreFactory.make("jnr-files")
      val downloadFile = Cache.cached[String, File](store) { assetId =>
        val downloadedFile = taskTemporaryDirectory.value / "jnr-bin.tar.gz"
        val url =
          s"https://api.github.com/repos/input-output-hk/midnight-ledger-prototype/releases/assets/$assetId"
        val authToken = sys.env("MIDNIGHT_GH_TOKEN")

        s"curl -o $downloadedFile -H @wallet-zswap/headers.txt --oauth2-bearer $authToken -L $url".!!
        val resourcesDir = (Compile / resourceDirectory).value
        IO.createDirectory(resourcesDir)
        s"tar -xzf $downloadedFile --strip-components=2 -C $resourcesDir".!!
        downloadedFile
      }

      val linuxAssetId = "122049350"
      downloadFile(linuxAssetId)

      val darwinAssetId = "123073047"
      downloadFile(darwinAssetId)
    },
    Compile / update := { (Compile / update).dependsOn(downloadLedgerBinaries).value },
    scalaVersion := scala33,
    commonPublishSettings,
    libraryDependencies ++= Seq(
      "org.typelevel" %% "cats-core" % catsVersion,
      "org.typelevel" %% "cats-effect" % catsEffectVersion,
      "com.github.jnr" % "jnr-ffi" % "2.2.13",
    ),
    // Test dependencies
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
      "org.scalacheck" %%% "scalacheck" % "1.15.4",
      "org.typelevel" %%% "scalacheck-effect-munit" % "1.0.3",
    ).map(_ % Test),
    Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b"),
  )

lazy val dist = taskKey[Unit]("Builds the lib")
lazy val distImpl = Def.task {
  (Compile / fullOptJS).value
  val targetJSDir = (Compile / fullLinkJS / scalaJSLinkerOutputDirectory).value
  val resDir = (Compile / resourceDirectory).value
  val distDir = baseDirectory.value / "dist"
  IO.createDirectory(distDir)
  IO.copyDirectory(targetJSDir, distDir, overwrite = true)
  IO.copyDirectory(resDir, distDir, overwrite = true)

  val gitHeadCommitFile = distDir / "git-head-commit"
  IO.write(gitHeadCommitFile, sys.env.getOrElse("rev", "git rev-parse HEAD" !!))

  streams.value.log.info(s"Dist done at ${distDir.absolutePath}")
}

addCommandAlias(
  "verify",
  Seq(
    "scalafmtCheckAll",
    "coverage",
    "jsInterop/test",
    "blocJS/test",
    "walletCore/test",
    "blockchainJS/test",
    "walletEngine/test",
    "zswap/test",
    "IntegrationTest/test",
    "coverageReport",
  ).mkString(";", " ;", ""),
)
