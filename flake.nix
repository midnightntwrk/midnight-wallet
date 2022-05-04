{
  description = "Midnight Wallet";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    utils.url = "github:numtide/flake-utils";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
    inclusive.url = "github:input-output-hk/nix-inclusive";
    yarn2nix.url = "github:input-output-hk/yarn2nix";
    sbt-derivation.url = "github:zaninime/sbt-derivation";
    cicero = {
      url = "github:input-output-hk/cicero";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, utils, inclusive, yarn2nix, sbt-derivation, cicero, ... }:
    utils.lib.eachSystem [ "x86_64-linux" ] (system:
      let
        pkgs = nixpkgs.legacyPackages.${system}.extend (nixpkgs.lib.composeManyExtensions [
          (final: prev: { jre = prev.jdk11; })
          sbt-derivation.overlay
          yarn2nix.overlay
        ]);

        packageJSON = __fromJSON (__readFile ./package.json);
      in rec {
        nodeModules = pkgs.mkYarnModules {
          name = "midnight-wallet-${packageJSON.version}";
          pname = packageJSON.name;
          version = packageJSON.version;
          packageJSON = ./package.json;
          yarnLock = ./yarn.lock;
        };

        packages.midnight-wallet = pkgs.sbt.mkDerivation rec {
          pname = "midnight-wallet";
          version = packageJSON.version;

          src = inclusive.lib.inclusive ./. [
            ./build.sbt
            ./integration-tests
            ./package.json
            ./project
            ./src
          ];

          depsSha256 = "sha256-sa8Nqvf9jKM80x8Wv5j6f6NDP7Mu6LN3V6N8LJ6IgYo=";

          # this is the command used to to create the fixed-output-derivation
          depsWarmupCommand = ''
            export rev=${nixpkgs.lib.escapeShellArg rev}
            export PATH="${nodeModules}/deps/midnight-wallet/node_modules/.bin:$PATH"
            ln -s ${nodeModules}/node_modules .
            sbt clean
            sbt dist --debug
            rm node_modules
          '';

          nativeBuildInputs = with pkgs; [ yarn nodejs ];

          preBuild = "ln -s ${nodeModules}/node_modules .";

          doCheck = true;
          checkPhase = "sbt test";

          installPhase = ''
            export PATH="${nodeModules}/deps/midnight-wallet/node_modules/.bin:$PATH"
            sbt dist
            mv dist $out
          '';

          rev = self.rev or "dirty";
        };

        defaultPackage = packages.midnight-wallet;

        devShell = pkgs.mkShell {
          inputsFrom = [ defaultPackage ];
        };
      }) // {
        ciceroActions = cicero.lib.callActionsWithExtraArgs rec {
          inherit (cicero.lib) std;
          inherit (nixpkgs) lib;
          actionLib = import "${cicero}/action-lib.nix" { inherit std lib; };
        } ./cicero;
      };
}
