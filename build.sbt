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

lazy val commonSettings = Seq(
  // Scala compiler options
  scalaVersion := "2.13.8",
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

lazy val domain = (project in file("domain"))
  .enablePlugins(ScalaJSPlugin)
  .settings(commonSettings: _*)
  .settings(
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq(
      "co.fs2" %%% "fs2-core" % "3.2.5",
      "io.circe" %%% "circe-core" % "0.14.1",
      "io.iohk.midnight" %%% "tracing-core" % "1.0.1",
      "io.iohk.midnight" %%% "tracing-log" % "1.0.1",
    ),
    coverageMinimumStmtTotal := 64,
    coverageMinimumBranchTotal := 100,
  )

lazy val walletCore = (project in file("wallet-core"))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .dependsOn(domain)
  .settings(commonSettings: _*)
  .settings(
    scalacOptions += "-P:kind-projector:underscore-placeholders",
    addCompilerPlugin("org.typelevel" % "kind-projector" % "0.13.2" cross CrossVersion.full),
    scalaJSLinkerConfig ~= { _.withSourceMap(false).withModuleKind(ModuleKind.ESModule) },

    // Dependencies
    libraryDependencies ++= Seq(
      "com.beachape" %%% "enumeratum" % "1.7.0",
      "com.softwaremill.sttp.client3" %%% "core" % "3.4.1",
      "com.softwaremill.sttp.client3" %%% "circe" % "3.4.1",
      "com.softwaremill.sttp.client3" %%% "cats" % "3.4.1",
      "co.fs2" %%% "fs2-core" % "3.2.5",
      "io.circe" %%% "circe-core" % "0.14.1",
      "io.circe" %%% "circe-generic" % "0.14.1",
      "io.circe" %%% "circe-generic-extras" % "0.14.1",
      "org.typelevel" %%% "cats-core" % "2.7.0",
      "org.typelevel" %%% "cats-effect" % "3.3.8",
      "org.typelevel" %%% "log4cats-core" % "2.1.0",
    ),

    // Test dependencies
    libraryDependencies += "org.typelevel" %%% "kittens" % "2.3.2" % Test,

    // ScalablyTyped config
    externalNpm := {
      if (!Env.nixBuild) Process("yarn", baseDirectory.value).! else Seq.empty
      baseDirectory.value
    },
    stIgnore += "rxjs",
    stEnableScalaJsDefined := Selection.All,
    Global / stQuiet := true,

    // Linting
    wartremoverExcluded += baseDirectory.value / "src" / "main" / "scala" / "io" / "iohk" / "midnight" / "wallet" / "js" / "facades",
    coverageExcludedPackages := "io.iohk.midnight.wallet.WalletBuilder;io.iohk.midnight.wallet.js;io.iohk.midnight.wallet.js.facades.rxjs",
    coverageMinimumStmtTotal := 90,
    coverageMinimumBranchTotal := 90,
  )

lazy val ogmiosSync = (project in file("ogmios-sync"))
  .enablePlugins(ScalaJSPlugin)
  .dependsOn(domain)
  .settings(commonSettings: _*)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    crossScalaVersions := Seq("2.13.8", "3.1.2"),
    conflictWarning := ConflictWarning.disable,
    libraryDependencies ++= Seq(
      "co.fs2" %%% "fs2-core" % "3.2.5",
      "com.softwaremill.sttp.client3" %%% "core" % "3.4.1",
      "com.softwaremill.sttp.client3" %%% "cats" % "3.4.1",
      "io.circe" %%% "circe-core" % "0.14.1",
      "io.circe" %%% "circe-parser" % "0.14.1",
      "io.circe" %%% "circe-generic" % "0.14.1",
      "org.typelevel" %%% "cats-core" % "2.7.0",
      "org.typelevel" %%% "cats-effect" % "3.3.11",
    ),
    coverageMinimumStmtTotal := 100,
    coverageMinimumBranchTotal := 100,
  )

lazy val integrationTests = (project in file("integration-tests"))
  .enablePlugins(ScalaJSPlugin)
  .dependsOn(walletCore)
  .settings(commonSettings: _*)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    Test / jsEnv := new org.scalajs.jsenv.selenium.SeleniumJSEnv(
      new org.openqa.selenium.firefox.FirefoxOptions(),
    ),
  )

lazy val dist = taskKey[Unit]("Builds the lib")
dist := {
  val log = streams.value.log
  (walletCore / Compile / fullOptJS).value
  val targetJSDir = (walletCore / Compile / fullLinkJS / scalaJSLinkerOutputDirectory).value
  val resDir = (walletCore / Compile / resourceDirectory).value
  val distDir = walletCore.base / "dist"
  IO.createDirectory(distDir)
  IO.copyDirectory(targetJSDir, distDir, overwrite = true)
  IO.copyDirectory(resDir, distDir, overwrite = true)

  val gitHeadCommitFile = distDir / "git-head-commit"
  IO.write(gitHeadCommitFile, sys.env.getOrElse("rev", "git rev-parse HEAD" !!))

  log.info(s"Dist done at ${distDir.absolutePath}")
}

addCommandAlias(
  "verify",
  ";scalafmtCheckAll ;coverage ;walletCore/test ;domain/test ;ogmiosSync/test ;coverageReport",
)
