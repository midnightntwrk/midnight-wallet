import scala.sys.process._

val nixBuild = sys.props.isDefinedAt("nix")

Global / onChangedBuildSource := ReloadOnSourceChanges

ThisBuild / scalaVersion := "2.13.8"

ThisProject / scalacOptions ~= { prev =>
  if (Env.devModeEnabled) prev.filterNot(_ == "-Xfatal-warnings") else prev
}

ThisBuild / scapegoatVersion := "1.4.12"
ThisBuild / scapegoatDisabledInspections := Seq("IncorrectlyNamedExceptions")
ThisBuild / scapegoatIgnoredFiles := Seq(".*/io/iohk/midnight/wallet/js/facades/.*")

ThisProject / scalacOptions ++= Seq(
  "-Xsource:3",
  "-Wunused:nowarn",
  "-P:kind-projector:underscore-placeholders",
)

Test / testOptions += Tests.Argument(TestFrameworks.MUnit, "-b")

lazy val warts = Warts.allBut(
  Wart.Any,
  Wart.DefaultArguments,
  Wart.ImplicitParameter,
  Wart.JavaSerializable,
  Wart.Nothing,
  Wart.Product,
  Wart.Serializable,
)

lazy val wallet = (project in file("."))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(
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
    libraryDependencies ++= Seq(
      "org.scalacheck" %%% "scalacheck" % "1.15.4",
      "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.1",
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
      "org.typelevel" %%% "scalacheck-effect-munit" % "1.0.3",
      "org.typelevel" %%% "kittens" % "2.3.2",
    ).map(_ % Test),

    // ScalablyTyped config
    externalNpm := {
      if (!nixBuild) Process("yarn", baseDirectory.value).! else Seq.empty
      baseDirectory.value
    },
    stIgnore += "rxjs",
    stEnableScalaJsDefined := Selection.All,
    Global / stQuiet := true,

    // Linting
    wartremoverErrors ++= (if (Env.devModeEnabled) Seq.empty else warts),
    wartremoverWarnings ++= (if (Env.devModeEnabled) warts else Seq.empty),
    wartremoverExcluded += baseDirectory.value / "src" / "main" / "scala" / "io" / "iohk" / "midnight" / "wallet" / "js" / "facades",
    coverageFailOnMinimum := true,
    coverageMinimumStmtTotal := 90,
    coverageMinimumBranchTotal := 90,
    coverageExcludedPackages := "io.iohk.midnight.wallet.WalletBuilder;io.iohk.midnight.wallet.js;io.iohk.midnight.wallet.js.facades.rxjs",
  )

lazy val integrationTests = (project in file("integration-tests"))
  .enablePlugins(ScalaJSPlugin)
  .dependsOn(wallet)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    Test / jsEnv := new org.scalajs.jsenv.selenium.SeleniumJSEnv(
      new org.openqa.selenium.firefox.FirefoxOptions(),
    ),
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
    ).map(_ % Test),
  )

lazy val dist = taskKey[Unit]("Builds the lib")
dist := {
  val log = streams.value.log
  (wallet / Compile / fullOptJS).value
  val targetJSDir = (wallet / Compile / fullLinkJS / scalaJSLinkerOutputDirectory).value
  val resDir = (wallet / Compile / resourceDirectory).value
  val distDir = baseDirectory.value / "dist"
  IO.createDirectory(distDir)
  IO.copyDirectory(targetJSDir, distDir, overwrite = true)
  IO.copyDirectory(resDir, distDir, overwrite = true)

  val gitHeadCommitFile = distDir / "git-head-commit"
  IO.write(gitHeadCommitFile, sys.env.getOrElse("rev", "git rev-parse HEAD" !!))

  log.info(s"Dist done at ${distDir.absolutePath}")
}

addCommandAlias("verify", ";scalafmtCheckAll ;scapegoat ;coverage ;test ;coverageReport")
