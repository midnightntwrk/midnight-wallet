import scala.sys.process.*
import LedgerBinariesDownloader.*
import sbt.io.FileFilter
import org.scalajs.jsenv.nodejs.NodeJSEnv

Global / onChangedBuildSource := ReloadOnSourceChanges

lazy val warts = Warts.allBut(
  Wart.Any,
  Wart.DefaultArguments,
  Wart.ImplicitParameter,
  Wart.JavaSerializable,
  Wart.Nothing,
  Wart.Overloading,
  Wart.Product,
  Wart.Recursion,
  Wart.Serializable,
)

val catsVersion = "2.9.0"
val catsEffectVersion = "3.5.0"
val circeVersion = "0.14.6"
val fs2Version = "3.7.0"
val log4CatsVersion = "2.4.0"
val midnightTracingVersion = "1.4.2"
val sttpClientVersion = "3.9.0"
val munitCatsEffectVersion = "2.0.0-M3"

val ghPackagesRealm = "GitHub Package Registry"
val ghPackagesHost = "maven.pkg.github.com"
val ghPackagesUrl = s"https://$ghPackagesHost/midnight-ntwrk/artifacts"
lazy val ghPackagesResolver =
  resolvers += ghPackagesRealm at ghPackagesUrl
lazy val ghPackagesCredentials =
  credentials += Credentials(
    ghPackagesRealm,
    ghPackagesHost,
    sys.env.getOrElse("MIDNIGHT_GH_USER", ""),
    sys.env.getOrElse("MIDNIGHT_GH_TOKEN", ""),
  )

lazy val commonSettings = Seq(
  // Scala compiler options
  scalaVersion := "3.4.2",
  scalacOptions ++= Seq("-Wunused:all", "-Wvalue-discard"),
  scalacOptions ~= { prev =>
    // Treat linting errors as warnings for quick development
    if (Env.devModeEnabled) prev.filterNot(_ == "-Xfatal-warnings") else prev
  },
  Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b"),
  ghPackagesResolver,

  // Test dependencies
  libraryDependencies ++= Seq(
    "org.typelevel" %%% "munit-cats-effect" % munitCatsEffectVersion,
    "org.scalacheck" %%% "scalacheck" % "1.17.0",
    "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.2",
    "org.typelevel" %%% "scalacheck-effect-munit" % "2.0.0-M2",
  ).map(_ % Test),

  // Linting
  wartremoverErrors ++= (if (Env.devModeEnabled) Seq.empty else warts),
  wartremoverWarnings ++= (if (Env.devModeEnabled) warts else Seq.empty),
)

lazy val commonPublishSettings = Seq(
  ghPackagesResolver,
  ghPackagesCredentials,
  organization := "io.iohk.midnight",
  version := "3.6.2",
  versionScheme := Some("early-semver"),
  publishTo := Some(ghPackagesRealm at ghPackagesUrl),
)

lazy val commonScalablyTypedSettings = Seq(
  externalNpm := {
    Process("yarn", baseDirectory.value).!!
    baseDirectory.value
  },
  stOutputPackage := "io.iohk.midnight",
  Global / stQuiet := true,
)

lazy val blockchain = project
  .in(file("blockchain"))
  .enablePlugins(ScalaJSPlugin)
  .settings(commonSettings)
  .settings(
    name := "wallet-blockchain",
    conflictWarning := ConflictWarning.disable,
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
    ),
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },
  )

lazy val bloc = project
  .in(file("bloc"))
  .enablePlugins(ScalaJSPlugin)
  .settings(commonSettings)
  .settings(
    name := "wallet-bloc",
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "co.fs2" %%% "fs2-core" % fs2Version,
    ),
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
  )

lazy val walletCore = project
  .in(file("wallet-core"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(
    jsInterop,
    bloc,
    blockchain % "compile->compile;test->test",
    walletZswap.js,
  )
  .settings(commonSettings)
  .settings(
    name := "wallet-core",
    Test / parallelExecution := false,
    Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b"),

    // Dependencies
    libraryDependencies ++= Seq(
      "co.fs2" %%% "fs2-core" % fs2Version,
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "org.typelevel" %%% "log4cats-core" % log4CatsVersion,
      "io.iohk.midnight" %%% "tracing-core" % midnightTracingVersion,
      "io.iohk.midnight" %%% "tracing-log" % midnightTracingVersion,
      "io.circe" %%% "circe-core" % circeVersion,
      "io.circe" %%% "circe-parser" % circeVersion,
      "io.circe" %%% "circe-generic" % circeVersion,
    ),
    commonScalablyTypedSettings,
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },
  )

lazy val walletEngine = (project in file("wallet-engine"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(
    walletCore % "compile->compile;test->test",
    proverClient,
    pubSubIndexerClient,
    substrateClient % "compile->compile;test->test",
    walletZswap.js,
  )
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    name := "wallet-engine",
    Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b"),
    dist := distImpl.value,
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },

    // ScalablyTyped config
    stIgnore ++= List(
      "testcontainers",
      "node-fetch",
      "scale-ts",
      "ws",
      "isomorphic-ws",
      "fp-ts",
      "io-ts",
      "io-ts-types",
      "newtype-ts",
      "monocle-ts",
    ),
  )

lazy val jsInterop = project
  .in(file("js-interop"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    name := "wallet-js-interop",
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "co.fs2" %%% "fs2-core" % fs2Version,
    ),
  )

lazy val downloadLedgerBinaries = taskKey[Unit]("Download ledger binaries")
lazy val testDownloadLedgerBinaries = taskKey[Unit]("Download ledger binaries for tests")
lazy val walletZswap = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Full)
  .in(file("wallet-zswap"))
  .settings(commonSettings, commonPublishSettings)
  .settings(name := "wallet-zswap")
  .jsConfigure(_.dependsOn(jsInterop, blockchain))
  .jsEnablePlugins(ScalablyTypedConverterExternalNpmPlugin)
  .jsSettings(
    commonScalablyTypedSettings,
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
  )
  .jvmSettings(
    cleanFiles += (Compile / resourceDirectory).value,
    libraryDependencies += "com.github.jnr" % "jnr-ffi" % "2.2.13",
    downloadLedgerBinaries := {
      val resourcesDir = (Compile / resourceDirectory).value
      IO.createDirectory(resourcesDir)

      downloadBinaries(
        Config(
          requiredAssets = List(Linux, Darwin),
          releaseTag = "zswap-c-bindings-3.0.1",
          ghAuthToken = sys.env("IOG_GH_TOKEN"),
          tempDir = taskTemporaryDirectory.value.getPath,
          resourcesDir = resourcesDir.getPath,
          logger = streams.value.log,
          versionAlias = "v1",
        ),
      )
    },
    testDownloadLedgerBinaries := {
      val resourcesDir = (Test / resourceDirectory).value
      IO.createDirectory(resourcesDir)
      downloadBinaries(
        Config(
          requiredAssets = List(Linux, Darwin),
          releaseTag = "zswap-c-bindings-0.3.11",
          ghAuthToken = sys.env("IOG_GH_TOKEN"),
          tempDir = taskTemporaryDirectory.value.getPath,
          resourcesDir = resourcesDir.getPath,
          logger = streams.value.log,
          versionAlias = "v2",
        ),
      )
    },
    Compile / update := { (Compile / update).dependsOn(downloadLedgerBinaries).value },
    Test / update := { (Test /update).dependsOn(testDownloadLedgerBinaries).value },
  )
  .settings(
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
    ),
    // Test dependencies
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
      "org.scalacheck" %%% "scalacheck" % "1.17.)",
      "org.typelevel" %%% "scalacheck-effect-munit" % "1.0.3",
    ).map(_ % Test),
    Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b"),
  )

lazy val proverClient = project
  .in(file("prover-client"))
  .dependsOn(walletZswap.js)
  .dependsOn(jsInterop)
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings)
  .settings(name := "wallet-prover-client")
  .settings(
    commonScalablyTypedSettings,
    stIgnore ++= List("node-fetch"),
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
  )
  .settings(
    libraryDependencies ++= Seq(
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
    ),
  )

lazy val substrateClient = project
  .in(file("substrate-client"))
  .dependsOn(jsInterop, walletZswap.js)
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    name := "wallet-substrate-client",
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq(
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      "com.softwaremill.sttp.client3" %%% "circe" % sttpClientVersion,
    ),
  )

lazy val pubSubIndexerClient = project
  .in(file("pubsub-indexer-client"))
  .dependsOn(jsInterop, blockchain)
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin, CalibanPlugin)
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    name := "wallet-pubsub-indexer-client",
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq(
      "com.github.ghostdogpr" %%% "caliban-client" % "2.3.0",
      "com.github.ghostdogpr" %%% "caliban-client-laminext" % "2.3.0",
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      "io.iohk.midnight" %%% "tracing-core" % midnightTracingVersion,
      "io.iohk.midnight" %%% "tracing-log" % midnightTracingVersion,
    ),
    stIgnore ++= List("ws", "isomorphic-ws"),
  )

lazy val integrationTests = project
  .in(file("integration-tests"))
  .dependsOn(
    walletEngine % "compile->compile;test->test",
    walletCore % "compile->compile;test->test",
  )
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings, commonScalablyTypedSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    // This is a workaround just to run these integration tests,
    // because ScalablyTyped generates directory imports for testcontainers,
    // which aren't allowed in newer nodejs versions
    jsEnv := new NodeJSEnv(NodeJSEnv.Config().withArgs(List("--import=extensionless/register"))),
    stIgnore ++= List(
      "extensionless",
      "node-fetch",
      "scale-ts",
      "ws",
      "isomorphic-ws",
      "fp-ts",
      "io-ts",
      "io-ts-types",
      "newtype-ts",
      "monocle-ts",
    ),
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "munit-cats-effect" % munitCatsEffectVersion,
      "org.scalacheck" %%% "scalacheck" % "1.17.0",
      "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.2",
      "org.typelevel" %%% "scalacheck-effect-munit" % "2.0.0-M2",
    ).map(_ % Test),
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
  IO.write(gitHeadCommitFile, sys.env.getOrElse("rev", "git rev-parse HEAD".!!))

  streams.value.log.info(s"Dist done at ${distDir.absolutePath}")
}

// coverage temporary removed - sbt-scoverage doesn't support scala 3 with scalajs yet
addCommandAlias(
  "verify",
  Seq(
    "scalafmtCheckAll",
//     "coverage",
    "jsInterop/test",
    "bloc/test",
    "blockchain/test",
    "walletZswapJVM/test",
    "substrateClient/test",
    "walletZswapJS/Test/compile",
    "proverClient/test",
    "walletCore/test",
    "walletEngine/test",
//     "coverageReport",
  ).mkString(";", " ;", ""),
)
