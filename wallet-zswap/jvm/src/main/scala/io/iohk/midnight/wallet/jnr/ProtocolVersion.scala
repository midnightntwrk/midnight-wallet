package io.iohk.midnight.wallet.jnr

enum ProtocolVersion(val name: String) {
  case V1 extends ProtocolVersion("v1")
  case V2 extends ProtocolVersion("v2")
}
