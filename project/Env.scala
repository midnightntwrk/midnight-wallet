object Env {
  val devModeEnabled: Boolean = Option(System.getenv("MIDNIGHT_DEV")).contains("true")
}
