package io.iohk.midnight.wallet.jnr

import jnr.ffi.Pointer
import jnr.ffi.types.size_t

trait LedgerAPI {
  def is_transaction_relevant(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
      serialized_encryption_secret_key: Array[Byte],
      @size_t serialized_encryption_secret_key_len: Int,
  ): Int

  def apply_transaction_to_state(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
      local_state: Array[Byte],
      @size_t local_state_len: Int,
  ): Pointer

  def free_apply_result(pointer: Pointer): Unit
}
