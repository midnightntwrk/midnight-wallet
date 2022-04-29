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
      #std.nix.build
      #CIC-159
      (std.script "bash" ''
        set -x
        echo "WIP..."
      '')
    ];
}
