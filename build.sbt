Global / onChangedBuildSource := ReloadOnSourceChanges

lazy val root = (project in file("."))
  .enablePlugins(ScalaJSPlugin)
  .settings(
    scalaVersion := "3.1.0",
    scalacOptions += "-language:strictEquality",
    scalaJSLinkerConfig ~= { _.withModuleKind(ModuleKind.ESModule) },
    libraryDependencies ++= Seq("org.typelevel" %%% "cats-core" % "2.7.0"),
    libraryDependencies ++= Seq(
      "org.scalacheck" %%% "scalacheck" % "1.15.4",
      "io.chrisdavenport" %%% "cats-scalacheck" % "0.3.1"
    ).map(_ % Test)
  )
