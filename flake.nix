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
          (final: prev: {
            # https://github.com/zaninime/sbt-derivation/issues/7
            sbt = prev.sbt // {
              mkDerivation = args: (prev.sbt.mkDerivation args).overrideAttrs (oldAttrs: {
                deps = oldAttrs.deps.overrideAttrs (depsOld: {
                  postBuild = ''
                    ${depsOld.postBuild or ""}
                    >&2 echo "fixing-up the compiler interface"
                    find .nix -name 'org.scala-sbt-compiler-interface*' -type f -print0 \
                    | xargs -r0 strip-nondeterminism
                  '';
                });
              });
            };
          })
          yarn2nix.overlay
        ]);

        packageJSON = __fromJSON (__readFile ./package.json);
      in rec {
        packages = {
          midnight-wallet-node-modules = pkgs.mkYarnModules {
            name = "midnight-wallet-${packageJSON.version}";
            pname = packageJSON.name;
            version = packageJSON.version;
            packageJSON = ./package.json;
            yarnLock = ./yarn.lock;
          };

          midnight-wallet = pkgs.sbt.mkDerivation rec {
            pname = "midnight-wallet";
            version = packageJSON.version;

            src = inclusive.lib.inclusive ./. [
              ./build.sbt
              ./integration-tests
              ./package.json
              ./project
              ./src
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

            nativeBuildInputs = with pkgs; [ yarn nodejs ];

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
