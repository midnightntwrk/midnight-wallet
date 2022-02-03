import scala.sys.process.Process

Global / onChangedBuildSource := ReloadOnSourceChanges

ThisBuild / scalaVersion := "2.13.8"
ThisBuild / scalacOptions += "-Xsource:3"

lazy val wallet = (project in file("."))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },

    // ScalablyTyped conversion configs
    externalNpm := {
      val log = streams.value.log
      val baseDir = baseDirectory.value
      val rootDirectory = baseDir.getParentFile
      val rootNodeModules = rootDirectory / "node_modules"
      Process(s"ln -sfF ${rootNodeModules.getAbsolutePath}", baseDir).!!
      log.info(
        s"Link done: ${baseDir.getAbsolutePath}/node_modules -> ${rootNodeModules.getAbsolutePath}",
      )
      baseDir
    },
    stIgnore ++= List("rxjs"),
    stEnableScalaJsDefined := Selection.All,

    // Dependencies
    libraryDependencies ++= Seq(
      "com.beachape" %%% "enumeratum" % "1.7.0",
      "com.softwaremill.sttp.client3" %%% "core" % "3.4.1",
      "com.softwaremill.sttp.client3" %%% "circe" % "3.4.1",
      "com.softwaremill.sttp.client3" %%% "cats" % "3.4.1",
      "co.fs2" %%% "fs2-core" % "3.2.0",
      "io.circe" %%% "circe-core" % "0.14.1",
      "io.circe" %%% "circe-generic" % "0.14.1",
      "io.circe" %%% "circe-generic-extras" % "0.14.1",
      "org.typelevel" %%% "cats-core" % "2.7.0",
      "org.typelevel" %%% "cats-effect" % "3.3.4",
    ),

    // Test dependencies
    libraryDependencies ++= Seq(
      "org.scalacheck" %%% "scalacheck" % "1.15.4",
      "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.1",
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
      "org.typelevel" %%% "scalacheck-effect-munit" % "1.0.3",
    ).map(_ % Test),

    // Linting
    wartremoverErrors ++= Warts.unsafe.diff(Seq(Wart.Any, Wart.Nothing, Wart.DefaultArguments)),
    coverageFailOnMinimum := true,
    coverageMinimumStmtTotal := 90,
    coverageMinimumBranchTotal := 90,
    coverageExcludedPackages := "io.iohk.midnight.wallet.WalletBuilder;io.iohk.midnight.wallet.js",
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
  val targetDir = (wallet / Compile / target).value
  val resDir = (wallet / Compile / resourceDirectory).value
  val distDir = targetDir / "dist"
  IO.createDirectory(distDir)
  IO.copyDirectory(targetJSDir, distDir, overwrite = true)
  IO.copyDirectory(resDir, distDir, overwrite = true)
  log.info(s"Dist done at ${distDir.absolutePath}")
}
