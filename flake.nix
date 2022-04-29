{
  description = "Midnight Wallet";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    utils.url = "github:kreisys/flake-utils";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
    sbt-derivation.url = "github:zaninime/sbt-derivation";
    cicero = {
      url = "github:input-output-hk/cicero";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    yarn2nix.url = "github:input-output-hk/yarn2nix";
    inclusive.url = "github:input-output-hk/nix-inclusive";
  };

  outputs = inputs@{ self, nixpkgs, utils, sbt-derivation, yarn2nix, cicero, ... }:
    utils.lib.eachSystem [ "x86_64-linux" ] (system:
      let
        overlay = (final: prev: { jre = prev.jdk11; });

        pkgs = import nixpkgs {
          inherit system;
          overlays = [ sbt-derivation.overlay overlay yarn2nix.overlay ];
        };

      in rec {
        inherit (inputs.inclusive.lib) inclusive;
        inherit (builtins.fromJSON (builtins.readFile ./package.json)) version;

        nodeModules = pkgs.yarn2nix-moretea.mkYarnModules {
          pname = "midnight-wallet";
          inherit version;
          packageJSON = ./package.json;
          yarnLock = ./yarn.lock;
        };

        packages.midnight-wallet = pkgs.sbt.mkDerivation {
          pname = "midnight-wallet";
          inherit version;

          src = inclusive ./. [
            ./build.sbt
            ./integration-tests
            ./package.json
            ./project
            ./src
          ];

          depsSha256 = "sha256-YAsGrvdspRBN+ztAw9j35MtNtz142yG9QnIGNmvaHQk=";

          # this is the command used to to create the fixed-output-derivation
          depsWarmupCommand = ''
            export PATH="${nodeModules}/deps/midnight-wallet/node_modules/.bin:$PATH"
            ln -s ${nodeModules}/node_modules .
            sbt clean
            sbt dist --debug
            rm node_modules
          '';


          nativeBuildInputs = [pkgs.yarn];
          installPhase = ''
            export PATH="${nodeModules}/deps/midnight-wallet/node_modules/.bin:$PATH"
            ln -s ${nodeModules}/node_modules .
            sbt dist
            mv dist $out
          '';
        };

        defaultPackage = packages.midnight-wallet;

        devShell = pkgs.mkShell {
          inputsFrom = [ defaultPackage ];
          nativeBuildInputs = [ pkgs.nodejs pkgs.yarn];
        };
      }) // {
        ciceroActions = cicero.lib.callActionsWithExtraArgs rec {
          inherit (cicero.lib) std;
          inherit (nixpkgs) lib;
          actionLib = import cicero/lib.nix { inherit cicero lib; };
        } cicero/actions;
      };
}
