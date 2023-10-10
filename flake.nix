{
  description = "Midnight Wallet";

  inputs = {
    midnight-ledger.url = "github:input-output-hk/midnight-ledger-prototype";
    midnight-ledger-legacy.url = "github:input-output-hk/midnight-ledger-prototype/v1.2.5";
    nixpkgs.follows = "midnight-ledger/nixpkgs";
    utils.follows = "midnight-ledger/utils";
  };

  outputs = {
    self,
    nixpkgs,
    utils,
    midnight-ledger,
    midnight-ledger-legacy,
    ...
  }:
    utils.lib.eachDefaultSystem (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
        ledgerPkgs = midnight-ledger.packages.${system};
        legacyLedgerPkgs = midnight-ledger-legacy.packages.${system};
      in rec {
        formatter = pkgs.alejandra;

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

        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.sbt
            pkgs.yarn
            ledgerPkgs.ledger
            pkgs.nodejs-18_x
            pkgs.which
            pkgs.git
            pkgs.curl
            pkgs.gnutar
          ];
        };
      }
    );
}
