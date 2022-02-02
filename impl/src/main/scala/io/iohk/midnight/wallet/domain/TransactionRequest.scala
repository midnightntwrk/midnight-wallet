package io.iohk.midnight.wallet.domain

case class TransactionRequest(
    publicTranscript: PublicTranscript,
    witness: String,
    function: String,
    nonce: String,
)
