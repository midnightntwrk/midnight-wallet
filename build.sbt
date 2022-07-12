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

lazy val scala213 = "2.13.8"
lazy val scala31 = "3.1.2"
lazy val supportedScalaVersions = List(scala213, scala31)
lazy val catsVersion = "2.7.0"
lazy val catsEffectVersion = "3.3.11"

lazy val commonSettings = Seq(
  // Scala compiler options
  scalaVersion := scala213,
  scalacOptions ~= { prev =>
    // Treat linting errors as warnings for quick development
    if (Env.devModeEnabled) prev.filterNot(_ == "-Xfatal-warnings") else prev
  },
  scalacOptions ++=
    Seq("-Wunused:nowarn") ++ {
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
)

lazy val commonPublishSettings = Seq(
  organization := "io.iohk.midnight",
  version := "0.0.14",
  repoUrl := {
    if (isSnapshot.value) "snapshots" at s"$nexus/maven-snapshots"
    else "releases" at s"$nexus/maven-releases"
  },
  versionScheme := Some("early-semver"),
  publishTo := Some(repoUrl.value),
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
      "io.circe" %%% "circe-core" % "0.14.1",
    ),
    coverageMinimumStmtTotal := 64,
    coverageMinimumBranchTotal := 100,
  )
  .jsSettings(
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },
  )

lazy val walletCore = (project in file("wallet-core"))
  .enablePlugins(ScalaJSPlugin)
  .dependsOn(blockchain.js)
  .settings(commonSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },

    // Dependencies
    libraryDependencies ++= Seq(
      "com.beachape" %%% "enumeratum" % "1.7.0",
      "com.softwaremill.sttp.client3" %%% "circe" % "3.4.1",
      "com.softwaremill.sttp.client3" %%% "cats" % "3.4.1",
      "co.fs2" %%% "fs2-core" % "3.2.5",
      "io.circe" %%% "circe-generic-extras" % "0.14.1",
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "org.typelevel" %%% "log4cats-core" % "2.1.0",
      "io.iohk.midnight" %%% "tracing-core" % "1.0.1",
      "io.iohk.midnight" %%% "tracing-log" % "1.0.1",
    ),

    // Test dependencies
    libraryDependencies += "org.typelevel" %%% "kittens" % "2.3.2" % Test,

    // Linting
    wartremoverExcluded += baseDirectory.value / "src" / "main" / "scala" / "io" / "iohk" / "midnight" / "wallet" / "core" / "js" / "facades",
    coverageExcludedPackages := "io.iohk.midnight.wallet.core.js;",
    coverageMinimumStmtTotal := 90,
    coverageMinimumBranchTotal := 90,
  )

lazy val ogmiosSync = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("ogmios-sync"))
  .dependsOn(blockchain)
  .settings(commonSettings)
  .settings(commonPublishSettings)
  .settings(
    name := "ogmios-sync",
    crossScalaVersions := supportedScalaVersions,
    conflictWarning := ConflictWarning.disable,
    libraryDependencies ++= Seq(
      "co.fs2" %%% "fs2-core" % "3.2.5",
      "com.softwaremill.sttp.client3" %%% "cats" % "3.4.1",
      "io.circe" %%% "circe-core" % "0.14.1",
      "io.circe" %%% "circe-parser" % "0.14.1",
      "io.circe" %%% "circe-generic" % "0.14.1",
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "io.iohk.midnight" %%% "tracing-core" % "1.0.1",
      "io.iohk.midnight" %%% "tracing-log" % "1.0.1",
    ),
    coverageExcludedPackages := "io.iohk.midnight.wallet.ogmios.sync.tracer;", // TODO: NLLW-361
    coverageMinimumStmtTotal := 100,
    coverageMinimumBranchTotal := 100,
  )
  .jsSettings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
  )

lazy val ogmiosTxSubmission = crossProject(JVMPlatform, JSPlatform)
  .crossType(CrossType.Pure)
  .in(file("ogmios-tx-submission"))
  .dependsOn(blockchain)
  .settings(commonSettings)
  .settings(commonPublishSettings)
  .settings(
    name := "ogmios-tx-submission",
    crossScalaVersions := supportedScalaVersions,
    conflictWarning := ConflictWarning.disable,
    libraryDependencies ++= Seq(
      "com.softwaremill.sttp.client3" %%% "cats" % "3.4.1",
      "io.circe" %%% "circe-core" % "0.14.1",
      "io.circe" %%% "circe-parser" % "0.14.1",
      "io.circe" %%% "circe-generic" % "0.14.1",
      "org.typelevel" %%% "cats-core" % catsVersion,
      "org.typelevel" %%% "cats-effect" % catsEffectVersion,
      "io.iohk.midnight" %%% "tracing-core" % "1.0.1",
      "io.iohk.midnight" %%% "tracing-log" % "1.0.1",
    ),
    coverageExcludedPackages := "io.iohk.midnight.wallet.ogmios.tx_submission.tracer;", // TODO: NLLW-361
    coverageMinimumStmtTotal := 100,
    coverageMinimumBranchTotal := 100,
  )
  .jsSettings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
  )

lazy val integrationTests = (project in file("integration-tests"))
  .enablePlugins(ScalaJSPlugin)
  .dependsOn(walletEngine)
  .settings(commonSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    Test / jsEnv := new org.scalajs.jsenv.selenium.SeleniumJSEnv(
      new org.openqa.selenium.firefox.FirefoxOptions(),
    ),
  )

lazy val walletEngine = (project in file("wallet-engine"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(walletCore, ogmiosSync.js, ogmiosTxSubmission.js)
  .settings(commonSettings)
  .settings(
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },

    // ScalablyTyped config
    externalNpm := {
      if (!Env.nixBuild) Process("yarn", baseDirectory.value).! else Seq.empty
      baseDirectory.value
    },
    stIgnore += "rxjs",
    stEnableScalaJsDefined := Selection.All,
    Global / stQuiet := true,

    // Linting
    coverageExcludedPackages := "io.iohk.midnight.wallet.engine.WalletBuilder;io.iohk.midnight.wallet.engine.js;",
    coverageMinimumStmtTotal := 90,
    coverageMinimumBranchTotal := 90,
  )

lazy val dist = taskKey[Unit]("Builds the lib")
dist := {
  val log = streams.value.log
  (walletEngine / Compile / fullOptJS).value
  val targetJSDir = (walletEngine / Compile / fullLinkJS / scalaJSLinkerOutputDirectory).value
  val resDir = (walletEngine / Compile / resourceDirectory).value
  val distDir = walletEngine.base / "dist"
  IO.createDirectory(distDir)
  IO.copyDirectory(targetJSDir, distDir, overwrite = true)
  IO.copyDirectory(resDir, distDir, overwrite = true)

  val gitHeadCommitFile = distDir / "git-head-commit"
  IO.write(gitHeadCommitFile, sys.env.getOrElse("rev", "git rev-parse HEAD" !!))

  log.info(s"Dist done at ${distDir.absolutePath}")
}

addCommandAlias(
  "verify",
  ";scalafmtCheckAll ;coverage ;walletCore/test ;blockchainJS/test ;ogmiosSyncJS/test ;ogmiosTxSubmissionJS/test ;walletEngine/test ;coverageReport",
)
