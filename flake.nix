{
  description = "Midnight Wallet";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.05";
    utils.url = "github:numtide/flake-utils";
  };

  outputs = {
    self,
    nixpkgs,
    utils,
    ...
  }:
    utils.lib.eachDefaultSystem (
      system: let
        pkgs = nixpkgs.legacyPackages.${system};
      in rec {
        formatter = pkgs.alejandra;

        devShells.typescript = pkgs.mkShell {
          packages = [pkgs.yarn pkgs.nodejs-18_x pkgs.which pkgs.git];

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
