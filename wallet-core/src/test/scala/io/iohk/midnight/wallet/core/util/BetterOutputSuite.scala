package io.iohk.midnight.wallet.core.util

import munit.FunSuite

trait BetterOutputSuite extends FunSuite {

  def suitePrefix: String = getClass.getSimpleName

  override def munitTestTransforms: List[TestTransform] =
    super.munitTestTransforms ++ List(
      new TestTransform("suite", t => t.withName(s"[$suitePrefix] ${t.name}")),
    )
}
