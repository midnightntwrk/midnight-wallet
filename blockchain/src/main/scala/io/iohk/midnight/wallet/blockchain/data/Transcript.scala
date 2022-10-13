package io.iohk.midnight.wallet.blockchain.data

final case class Query(functionName: FunctionName, arg: ArbitraryJson, result: ArbitraryJson)

final case class Transcript(value: Seq[Query]) extends AnyVal
