package io.iohk.midnight.wallet.indexer

import munit.FunSuite

class LegacyIndexerCheckSpec extends FunSuite {

  test(
    "returns true if value is greater than or equal",
  ) {
    assertEquals(true, LegacyIndexerCheck.isVersionGreaterThanOrEqual("2.3.0", "2.3.0"))
    assertEquals(true, LegacyIndexerCheck.isVersionGreaterThanOrEqual("2.3.1", "2.3.0"))
    assertEquals(true, LegacyIndexerCheck.isVersionGreaterThanOrEqual("2.3.12", "2.3.0"))
    assertEquals(true, LegacyIndexerCheck.isVersionGreaterThanOrEqual("2.4.0", "2.3.0"))
    assertEquals(true, LegacyIndexerCheck.isVersionGreaterThanOrEqual("4.3.0", "2.3.0"))
    assertEquals(true, LegacyIndexerCheck.isVersionGreaterThanOrEqual("4.4.4", "2.3.0"))
  }

  test(
    "returns false if value is less than",
  ) {
    assertEquals(false, LegacyIndexerCheck.isVersionGreaterThanOrEqual("0.1.0", "2.3.0"))
    assertEquals(false, LegacyIndexerCheck.isVersionGreaterThanOrEqual("1.3.0", "2.3.0"))
    assertEquals(false, LegacyIndexerCheck.isVersionGreaterThanOrEqual("2.1.8", "2.3.0"))
    assertEquals(false, LegacyIndexerCheck.isVersionGreaterThanOrEqual("2.1.88", "2.3.0"))
    assertEquals(false, LegacyIndexerCheck.isVersionGreaterThanOrEqual("2.2.9", "2.3.0"))
  }
}
