import scala.sys.process.*
import sbt.util.CacheImplicits.*

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
lazy val nexus = "https://nexus.p42.at/repository"
lazy val repoUrl = taskKey[MavenRepository]("Repository for publishing")

val scala33 = "3.3.0"
val catsVersion = "2.9.0"
val catsEffectVersion = "3.5.0"
val circeVersion = "0.14.6"
val fs2Version = "3.7.0"
val log4CatsVersion = "2.4.0"
val midnightTracingVersion = "1.3.0"
val sttpClientVersion = "3.9.0"
val munitCatsEffectVersion = "2.0.0-M3"

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
  scalaVersion := scala33,
  scalacOptions ++= Seq("-Wunused:all", "-Wvalue-discard"),
  scalacOptions ~= { prev =>
    // Treat linting errors as warnings for quick development
    if (Env.devModeEnabled) prev.filterNot(_ == "-Xfatal-warnings") else prev
  },
  Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b"),

  // Private Nexus repository config
  nexusRepo,
  nexusCredentials,

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
  version := "3.3.3",
  versionScheme := Some("early-semver"),
  publishTo := Some(ghPackagesRealm at ghPackagesUrl),
)

lazy val commonScalablyTypedSettings = Seq(
  externalNpm := {
    if (!Env.nixBuild) Process("yarn", baseDirectory.value).!!
    baseDirectory.value
  },
  stOutputPackage := "io.iohk.midnight",
  Global / stQuiet := true,
)

lazy val blockchain = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("blockchain"))
  .settings(commonSettings, commonPublishSettings)
  .settings(
    name := "wallet-blockchain",
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
  .settings(commonSettings, commonPublishSettings)
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

lazy val walletCore = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("wallet-core"))
  .dependsOn(
    bloc,
    blockchain % "compile->compile;test->test",
    proverClient % "test->test",
    walletZswap,
  )
  .settings(commonSettings, commonPublishSettings)
  .settings(
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
      "io.circe" %%% "circe-generic" % circeVersion
    ),

    // Test dependencies
    libraryDependencies += "org.typelevel" %%% "kittens" % "3.0.0" % Test,

    // Coverage
    coverageExcludedPackages := "" +
      "io.iohk.midnight.wallet.core.WalletError.BadTransactionFormat;" +
      "io.iohk.midnight.wallet.core.Instances;",
  )
  .jsConfigure(_.dependsOn(jsInterop))
  .jsEnablePlugins(ScalablyTypedConverterExternalNpmPlugin)
  .jsSettings(
    commonScalablyTypedSettings,
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },
    useNodeModuleResolution,
  )

lazy val walletEngine = (project in file("wallet-engine"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(
    walletCore.js % "compile->compile;test->test",
    proverClient.js % "compile->compile;test->test",
    pubSubIndexerClient % "compile->compile;test->test",
    substrateClient % "compile->compile;test->test",
    walletZswap.js,
  )
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
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
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "co.fs2" %%% "fs2-core" % fs2Version,
    ),
    coverageExcludedPackages := "io.iohk.midnight.js.interop.util.ObservableOps",
  )

lazy val downloadLedgerBinaries = taskKey[File]("Download ledger binaries")
lazy val walletZswap = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Full)
  .in(file("wallet-zswap"))
  .settings(commonSettings, commonPublishSettings)
  .jsConfigure(_.dependsOn(jsInterop))
  .jsEnablePlugins(ScalablyTypedConverterExternalNpmPlugin)
  .jsSettings(
    commonScalablyTypedSettings,
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
  )
  .jvmSettings(
    libraryDependencies += "com.github.jnr" % "jnr-ffi" % "2.2.13",
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

      val linuxAssetId = "132688689"
      downloadFile(linuxAssetId)

      val darwinAssetId = "132688104"
      downloadFile(darwinAssetId)
    },
    Compile / update := { (Compile / update).dependsOn(downloadLedgerBinaries).value },
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

lazy val proverClient = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("prover-client"))
  .dependsOn(walletZswap)
  .jsConfigure(_.dependsOn(jsInterop))
  .jsEnablePlugins(ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings, commonPublishSettings)
  .jsSettings(
    commonScalablyTypedSettings,
    stIgnore ++= List("node-fetch"),
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    useNodeModuleResolution,
  )
  .jvmSettings(
    libraryDependencies += "com.softwaremill.sttp.client3" %% "fs2" % sttpClientVersion,
  )
  .settings(
    libraryDependencies ++= Seq(
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "io.github.enriquerodbe" %%% "borsh4s" % "3.0.0",
    ),
  )

lazy val substrateClient = project
  .in(file("substrate-client"))
  .dependsOn(jsInterop)
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq(
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      "com.softwaremill.sttp.client3" %%% "circe" % sttpClientVersion,
    ),
  )

lazy val pubSubIndexerClient = project
  .in(file("pubsub-indexer-client"))
  .dependsOn(jsInterop)
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin, CalibanPlugin)
  .settings(commonSettings)
  .settings(commonScalablyTypedSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    useNodeModuleResolution,
    libraryDependencies ++= Seq(
      "com.github.ghostdogpr" %%% "caliban-client" % "2.3.0",
      "com.github.ghostdogpr" %%% "caliban-client-laminext" % "2.3.0",
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      // Caliban client-laminext uses java.util.UUID and here is the ScalaJS implementation
      "org.scala-js" %%% "scalajs-java-securerandom" % "1.0.0" cross (CrossVersion.for3Use2_13),
    ),
    stIgnore ++= List("ws", "isomorphic-ws"),
  )

lazy val integrationTests = project
  .in(file("integration-tests"))
  .dependsOn(
    walletEngine % "compile->compile;it->test",
    walletCore.js % "compile->compile;it->test",
  )
  .configs(IntegrationTest)
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(commonSettings, commonScalablyTypedSettings)
  .settings(
    Defaults.itSettings,
    inConfig(IntegrationTest)(ScalaJSPlugin.testConfigSettings),
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    useNodeModuleResolution,
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
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "munit-cats-effect" % munitCatsEffectVersion,
      "org.scalacheck" %%% "scalacheck" % "1.17.0",
      "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.2",
      "org.typelevel" %%% "scalacheck-effect-munit" % "2.0.0-M2",
      // scalajs-test-bridge is not visible in IT context and needs to be explicitly added as dependency
      "org.scala-js" %% "scalajs-test-bridge" % "1.13.2" cross (CrossVersion.for3Use2_13),
    ).map(_ % IntegrationTest),
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
    // Need to execute stImport sequentially before compiling/testing
    // Because otherwise they'll run in parallel and do yarn install concurrently
    // And yarn seems to have problems with that
    "jsInterop/stImport",
    "substrateClient/stImport",
    "walletZswapJS/stImport",
    "proverClientJS/stImport",
    "walletCoreJS/stImport",
    "walletEngine/stImport",
    "scalafmtCheckAll",
    // "coverage",
    "jsInterop/test",
    "blocJS/test",
    "blockchainJS/test",
    "walletZswapJVM/test",
    "substrateClient/test",
    "walletZswapJS/Test/compile",
    "proverClientJS/test",
    "walletCoreJS/test",
    "walletCoreJVM/compile",
    "walletEngine/test",
    // "coverageReport",
  ).mkString(";", " ;", ""),
)
