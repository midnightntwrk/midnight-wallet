{
  description = "Midnight Wallet";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-22.11";
    utils.url = "github:numtide/flake-utils";
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
    inclusive.url = "github:input-output-hk/nix-inclusive";
    yarn2nix.url = "github:input-output-hk/yarn2nix";
    sbt-derivation.url = "github:zaninime/sbt-derivation";
    midnight-ledger.url = "github:input-output-hk/midnight-ledger-prototype/v1.3.0";
    midnight-ledger-legacy.url = "github:input-output-hk/midnight-ledger-prototype/v1.2.5";
  };

  outputs = {
    self,
    nixpkgs,
    utils,
    inclusive,
    yarn2nix,
    sbt-derivation,
    midnight-ledger,
    midnight-ledger-legacy,
    ...
  }:
    utils.lib.eachDefaultSystem (
      system: let
        pkgs = nixpkgs.legacyPackages.${system}.extend (nixpkgs.lib.composeManyExtensions [
          (final: prev: {jre = prev.jdk17;})
          sbt-derivation.overlays.default
          yarn2nix.overlay
        ]);
        ledgerPkgs = midnight-ledger.packages.${system};
        legacyLedgerPkgs = midnight-ledger-legacy.packages.${system};

        packageJSON = __fromJSON (__readFile ./wallet-engine/package.json);

        lib = pkgs.lib;
      in rec {
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
              ./build.sbtf
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

            nativeBuildInputs = with pkgs; [yarn nodejs-16_x ledgerPkgs.ledger];

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

        formatter = pkgs.alejandra;

        defaultPackage = packages.midnight-wallet;
        mkShell = {realProofs}: let
          ledgerPkg =
            if realProofs
            then ledgerPkgs.ledger
            else ledgerPkgs.ledger-no-proofs;
          packages = [pkgs.yarn pkgs.sbt pkgs.nodejs-16_x pkgs.which ledgerPkg pkgs.git pkgs.curl pkgs.gnutar];
          shellHook = lib.attrsets.optionalAttrs (!realProofs) {
            shellHook = "export NO_PROOFS=true";
          };
        in
          pkgs.mkShell ({inherit packages;} // shellHook);

        devShells.real-proofs = mkShell {realProofs = true;};

        devShells.no-proofs = mkShell {realProofs = false;};

        devShells.typescript = pkgs.mkShell {
          packages = [pkgs.yarn pkgs.nodejs-18_x pkgs.which legacyLedgerPkgs.ledger-napi pkgs.git];

          shellHook = ''
            cd typescript
            if [ ! -e node_modules ]; then
              yarn
            fi
            turboBinDir=$(dirname $(yarn bin turbo))
            export PATH=$PATH:$turboBinDir
          '';
        };

        devShells.default = devShells.real-proofs;
      }
    );
}
