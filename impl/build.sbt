import scala.sys.process.Process

Global / onChangedBuildSource := ReloadOnSourceChanges

lazy val wallet = (project in file("."))
  .enablePlugins(ScalaJSPlugin, ScalablyTypedConverterExternalNpmPlugin)
  .settings(
    scalaVersion := "2.13.8",
    scalacOptions += "-Xsource:3",
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
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
    stIgnore += "rxjs",
    libraryDependencies ++= Seq(
      "com.beachape" %%% "enumeratum" % "1.7.0",
      "com.softwaremill.sttp.client3" %%% "core" % "3.3.18",
      "com.softwaremill.sttp.client3" %%% "circe" % "3.3.18",
      "com.softwaremill.sttp.client3" %%% "cats" % "3.3.18",
      "io.circe" %%% "circe-core" % "0.14.1",
      "io.circe" %%% "circe-generic" % "0.14.1",
      "org.typelevel" %%% "cats-core" % "2.7.0",
      "org.typelevel" %%% "cats-effect" % "3.3.4",
    ),
    libraryDependencies ++= Seq(
      "org.scalacheck" %%% "scalacheck" % "1.15.4",
      "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.1",
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
      "org.typelevel" %%% "scalacheck-effect-munit" % "1.0.3",
    ).map(_ % Test),
    wartremoverErrors ++= Warts.unsafe.diff(Seq(Wart.Any, Wart.Nothing, Wart.DefaultArguments)),
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
