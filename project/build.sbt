val catsEffectVersion = "3.5.0"
val catsVersion = "2.9.0"
val sttpClientVersion = "3.8.15"
val circeVersion = "0.14.5"

libraryDependencies ++= Seq(
  "org.typelevel" %% "cats-core" % catsVersion,
  "org.typelevel" %% "cats-effect" % catsEffectVersion,
  "com.softwaremill.sttp.client3" %% "core" % sttpClientVersion,
  "com.softwaremill.sttp.client3" %% "circe" % sttpClientVersion,
  "io.circe" %% "circe-generic" % circeVersion
)