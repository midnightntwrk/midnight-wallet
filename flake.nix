{
  description = "Midnight Wallet";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/release-22.05";
    utils.url = "github:numtide/flake-utils";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
    inclusive.url = "github:input-output-hk/nix-inclusive";
    yarn2nix.url = "github:input-output-hk/yarn2nix";
    sbt-derivation.url = "github:zaninime/sbt-derivation";
    tullia.url = "github:input-output-hk/tullia";
    alejandra = {
      url = "github:kamadorueda/alejandra";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = {
    self,
    nixpkgs,
    utils,
    inclusive,
    yarn2nix,
    sbt-derivation,
    tullia,
    alejandra,
    ...
  }:
    utils.lib.eachDefaultSystem (
      system: let
        pkgs = nixpkgs.legacyPackages.${system}.extend (nixpkgs.lib.composeManyExtensions [
          (final: prev: {jre = prev.jdk17;})
          sbt-derivation.overlays.default
          yarn2nix.overlay
        ]);

        packageJSON = __fromJSON (__readFile ./wallet-engine/package.json);
      in
        rec {
          packages = {
            midnight-wallet-node-modules = pkgs.mkYarnModules {
              name = "midnight-wallet-${packageJSON.version}";
              pname = packageJSON.name;
              version = packageJSON.version;
              packageJSON = ./wallet-engine/package.json;
              yarnLock = ./wallet-engine/yarn.lock;
            };

            midnight-wallet = pkgs.sbt.mkDerivation rec {
              pname = "midnight-wallet";
              version = packageJSON.version;

              src = inclusive.lib.inclusive ./. [
                ./build.sbt
                ./project
                ./wallet-engine/package.json
                ./wallet-engine/src
              ];

              depsSha256 = "sha256-0nS5xlI3XIPmIbuaZnIS+lbnsA6b57FZml/wl/h/nbE=";

              # this is the command used to to create the fixed-output-derivation
              depsWarmupCommand = ''
                export rev=${nixpkgs.lib.escapeShellArg rev}
                export PATH="${packages.midnight-wallet-node-modules}/deps/midnight-wallet/node_modules/.bin:$PATH"
                ln -s ${packages.midnight-wallet-node-modules}/node_modules .
                sbt clean
                sbt dist --debug
                rm node_modules
              '';

              nativeBuildInputs = with pkgs; [yarn nodejs-16_x];

              preBuild = "ln -s ${packages.midnight-wallet-node-modules}/node_modules .";

              doCheck = true;
              checkPhase = "sbt test";

              installPhase = ''
                export PATH="${packages.midnight-wallet-node-modules}/deps/midnight-wallet/node_modules/.bin:$PATH"
                sbt dist
                mv dist $out
              '';

              rev = self.rev or "dirty";
            };
          };

          formatter = alejandra.packages.${system}.default;

          defaultPackage = packages.midnight-wallet;

          devShell = pkgs.mkShell {
            inputsFrom = [defaultPackage];
          };
        }
        // tullia.fromSimple system {
          tasks = import tullia/tasks.nix;
          actions = import tullia/actions.nix;
        }
    );
}
