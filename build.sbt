import scala.sys.process._

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
val scala32 = "3.2.1"
val supportedScalaVersions = List(scala213, scala32)
val catsVersion = "2.9.0"
val catsEffectVersion = "3.4.2"
val circeVersion = "0.14.2"
val fs2Version = "3.4.0"
val log4CatsVersion = "2.4.0"
val midnightTracingVersion = "1.2.0"
val sttpClientVersion = "3.4.1"

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
  resolvers +=
    "Sonatype Nexus Repository Manager" at "https://nexus.p42.at/repository/maven-releases",
  credentials += Credentials(
    "Sonatype Nexus Repository Manager",
    "nexus.p42.at",
    sys.env("MIDNIGHT_REPO_USER"),
    sys.env("MIDNIGHT_REPO_PASS"),
  ),

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

lazy val commonPublishSettings = Seq(
  organization := "io.iohk.midnight",
  version := "2.8.3",
  repoUrl := {
    if (isSnapshot.value) "snapshots" at s"$nexus/maven-snapshots"
    else "releases" at s"$nexus/maven-releases"
  },
  versionScheme := Some("early-semver"),
  publishTo := Some(repoUrl.value),
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
    ),

    // Test dependencies
    libraryDependencies += "org.typelevel" %%% "kittens" % "2.3.2" % Test,
    useNodeModuleResolution,
  )

lazy val ouroborosCore = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("mocked-node-client/ouroboros-core"))
  .settings(commonSettings)
  .settings(commonPublishSettings)
  .settings(
    name := "ouroboros-core",
    crossScalaVersions := supportedScalaVersions,
    conflictWarning := ConflictWarning.disable,
    libraryDependencies ++= Seq(
      "co.fs2" %%% "fs2-core" % fs2Version,
      "com.softwaremill.sttp.client3" %%% "cats" % sttpClientVersion,
      "io.circe" %%% "circe-core" % circeVersion,
      "io.circe" %%% "circe-parser" % circeVersion,
      "io.circe" %%% "circe-generic" % circeVersion,
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "io.iohk.midnight" %%% "tracing-core" % midnightTracingVersion,
      "io.iohk.midnight" %%% "tracing-log" % midnightTracingVersion,
    ),
    coverageExcludedPackages := "io.iohk.midnight.wallet.ouroboros.tracer",
  )
  .jsSettings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "log4cats-core" % log4CatsVersion,
    ),
  )

lazy val ouroborosSyncMiniProtocol = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Full)
  .in(file("mocked-node-client/ouroboros-sync-mini-protocol"))
  .jsEnablePlugins(ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(ouroborosCore % "compile->compile;test->test")
  .jsConfigure(_.dependsOn(jsInterop))
  .settings(commonSettings)
  .settings(commonPublishSettings)
  .settings(
    name := "ouroboros-sync-mini-protocol",
    crossScalaVersions := supportedScalaVersions,
    conflictWarning := ConflictWarning.disable,
    coverageExcludedPackages := Seq(
      "io.iohk.midnight.wallet.ouroboros.sync.JsOuroborosSyncServiceBuilder",
      "io.iohk.midnight.wallet.ouroboros.sync.Init",
    ).mkString(";"),
  )
  .jsSettings(commonScalablyTypedSettings)
  .jsSettings(
    dist := distImpl.value,
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },

    // ScalablyTyped config
    stIgnore ++= List("cross-fetch", "isomorphic-ws", "rxjs", "ws"),
    useNodeModuleResolution,
  )

lazy val ouroborosTxSubmissionMiniProtocol = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("mocked-node-client/ouroboros-tx-submission-mini-protocol"))
  .dependsOn(ouroborosCore % "compile->compile;test->test")
  .settings(commonSettings)
  .settings(commonPublishSettings)
  .settings(
    name := "ouroboros-tx-submission-mini-protocol",
    crossScalaVersions := supportedScalaVersions,
    conflictWarning := ConflictWarning.disable,
  )
  .jsSettings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
  )

lazy val walletEngine = (project in file("wallet-engine"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(
    walletCore % "compile->compile;test->test",
    ouroborosSyncMiniProtocol.js,
    ouroborosTxSubmissionMiniProtocol.js,
  )
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
    "ouroborosCoreJS/test",
    "ouroborosSyncMiniProtocolJS/test",
    "ouroborosTxSubmissionMiniProtocolJS/test",
    "walletEngine/test",
    "IntegrationTest/test",
    "coverageAggregate",
  ).mkString(";", " ;", ""),
)
