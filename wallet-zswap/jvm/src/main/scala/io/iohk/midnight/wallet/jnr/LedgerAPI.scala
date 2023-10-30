package io.iohk.midnight.wallet.jnr

import jnr.ffi.Pointer
import jnr.ffi.types.size_t

trait LedgerAPI {

  def set_network_id(
      @size_t networkId: Int,
  ): Pointer

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

  def extract_guaranteed_coins_from_transaction(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
  ): Pointer

  def extract_fallible_coins_from_transaction(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
  ): Pointer

  def zswap_chain_state_new(): Pointer

  def zswap_chain_state_first_free(
      zswap_chain_state: Array[Byte],
      @size_t zswap_chain_state_len: Int,
  ): Pointer

  def zswap_chain_state_try_apply(
      zswap_chain_state: Array[Byte],
      @size_t zswap_chain_state_len: Int,
      offer: Array[Byte],
      @size_t offer_len: Int,
  ): Pointer

  def merkle_tree_collapsed_update_new(
      zswap_chain_state: Array[Byte],
      @size_t zswap_chain_state_len: Int,
      @size_t index_start: Long,
      @size_t index_end: Long,
  ): Pointer

  def free_string_result(pointer: Pointer): Unit

  def free_number_result(pointer: Pointer): Unit
}
