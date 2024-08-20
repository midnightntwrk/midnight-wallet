package io.iohk.midnight.wallet.jnr

import jnr.ffi.Pointer
import jnr.ffi.types.size_t

trait LedgerAPI {

  def es_key_try_deserialize(
      serialized_encryption_secret_key: Array[Byte],
      @size_t serialized_encryption_secret_key_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def is_transaction_relevant(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
      serialized_encryption_secret_key: Array[Byte],
      @size_t serialized_encryption_secret_key_len: Int,
      @size_t networkId: Int,
  ): Int

  def apply_transaction_to_state(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
      local_state: Array[Byte],
      @size_t local_state_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def extract_guaranteed_coins_from_transaction(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def extract_fallible_coins_from_transaction(
      tx_borshed: Array[Byte],
      @size_t tx_borshed_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def zswap_chain_state_new(@size_t networkId: Int): Pointer

  def zswap_chain_state_first_free(
      zswap_chain_state: Array[Byte],
      @size_t zswap_chain_state_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def zswap_chain_state_filter(
      zswap_chain_state: Array[Byte],
      @size_t zswap_chain_state_len: Int,
      contract_address: Array[Byte],
      @size_t contract_address_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def zswap_chain_state_merkle_tree_root(
      zswap_chain_state_serialized: Array[Byte],
      @size_t zswap_chain_state_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def zswap_chain_state_try_apply(
      zswap_chain_state: Array[Byte],
      @size_t zswap_chain_state_len: Int,
      offer: Array[Byte],
      @size_t offer_len: Int,
      @size_t networkId: Int,
  ): Pointer

  def merkle_tree_collapsed_update_new(
      zswap_chain_state: Array[Byte],
      @size_t zswap_chain_state_len: Int,
      @size_t index_start: Long,
      @size_t index_end: Long,
      @size_t networkId: Int,
  ): Pointer

  def free_string_result(pointer: Pointer): Unit

  def free_number_result(pointer: Pointer): Unit
}
