Global / onChangedBuildSource := ReloadOnSourceChanges

lazy val wallet = (project in file("."))
  .enablePlugins(ScalaJSPlugin)
  .settings(
    scalaVersion := "3.1.0",
    scalacOptions += "-language:strictEquality",
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq(
      "org.typelevel" %%% "cats-core" % "2.7.0",
      "org.typelevel" %%% "cats-effect" % "3.3.4",
    ),
    libraryDependencies ++= Seq(
      "org.scalacheck" %%% "scalacheck" % "1.15.4",
      "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.1",
      "org.typelevel" %%% "munit-cats-effect-3" % "1.0.7",
      "org.typelevel" %%% "scalacheck-effect-munit" % "1.0.3",
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
