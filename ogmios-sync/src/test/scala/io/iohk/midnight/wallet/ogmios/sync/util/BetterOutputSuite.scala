package io.iohk.midnight.wallet.ogmios.sync.util

import munit.FunSuite

// [TODO NLLW-361]
trait BetterOutputSuite extends FunSuite {

  def suitePrefix: String = getClass.getSimpleName

  override def munitTestTransforms: List[TestTransform] =
    super.munitTestTransforms ++ List(
      new TestTransform("suite", t => t.withName(s"[$suitePrefix] ${t.name}")),
    )
}
