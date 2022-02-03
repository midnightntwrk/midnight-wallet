package io.iohk.midnight.wallet.domain

final case class TransitionFunctionCircuits(values: Map[String, String]) extends AnyVal

final case class CircuitValues(x: Int, y: Int, z: Int)

object CircuitValues {
  val hardcoded: CircuitValues = CircuitValues(2, 3, 13)
}
