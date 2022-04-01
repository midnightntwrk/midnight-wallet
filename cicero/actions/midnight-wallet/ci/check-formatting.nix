{ name, std, lib, actionLib, ... } @ args:

{
  inputs.start = ''
    "midnight-wallet/ci": start: {
      ${actionLib.common.inputStartCue}
    }
  '';

  output = { start }:
    actionLib.common.output args
      start.value."midnight-wallet/ci".start;

  job = { start }:
    std.chain args [
      actionLib.simpleJob
      (actionLib.common.task
        start.value."midnight-wallet/ci".start)
      (std.script "bash" ''
        sbt scalafmtCheckAll
      '')
    ];
}
