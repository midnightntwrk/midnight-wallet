package io.iohk.midnight.wallet.core.capabilities

import io.iohk.midnight.wallet.core.util.BetterOutputSuite

trait WalletBlockProcessingSpec[TWallet, TBlock] extends BetterOutputSuite {

  val walletBlockProcessing: WalletBlockProcessing[TWallet, TBlock]
  val walletForBlocks: TWallet
  val validBlockToApply: TBlock
  val blockToApplyWithBadFormatTx: TBlock
  val isBlockApplied: TWallet => Boolean

  test("apply block to the wallet") {
    val isApplied =
      walletBlockProcessing.applyBlock(walletForBlocks, validBlockToApply).map(isBlockApplied)
    assert(isApplied.getOrElse(false))
  }

  test("return error for block with transaction with bad format") {
    val error = walletBlockProcessing.applyBlock(walletForBlocks, blockToApplyWithBadFormatTx)
    assert(error.isLeft)
  }

}
