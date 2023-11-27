addSbtPlugin("org.portable-scala" % "sbt-scalajs-crossproject" % "1.2.0")
addSbtPlugin("org.scala-js" % "sbt-scalajs" % "1.14.0")
addSbtPlugin("org.scalameta" % "sbt-scalafmt" % "2.5.0")
addSbtPlugin("io.github.davidgregory084" % "sbt-tpolecat" % "0.1.20")
addSbtPlugin("org.wartremover" % "sbt-wartremover" % "3.1.3")
addSbtPlugin("org.scoverage" % "sbt-scoverage" % "2.0.8")
addSbtPlugin("org.scalablytyped.converter" % "sbt-converter" % "1.0.0-beta42")
addSbtPlugin("com.github.ghostdogpr" % "caliban-codegen-sbt" % "2.4.1")

/*
Fixing a version conflict between transitive dependencies
 * org.scala-lang.modules:scala-xml_2.12:2.1.0 (early-semver) is selected over 1.3.0
    +- org.scoverage:scalac-scoverage-reporter_2.12:2.0.1 (depends on 2.1.0)
    +- org.scalablytyped.converter:scalajs_2.12:1.0.0-beta39 (depends on 1.3.0)
 */
dependencyOverrides ++= Seq(
  "org.scala-lang.modules" %% "scala-xml" % "2.1.0",
  "com.lihaoyi" %% "geny" % "1.0.0"
)
