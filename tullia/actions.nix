{
    "midnight-wallet/ci" = {
      task = "build";
      io = ''
        let github = {
          #input: "GitHub event"
          #repo: "input-output-hk/midnight-wallet"
        }
        #lib.merge
        #ios: [
          #lib.io.github_push & github,
          #lib.io.github_pr   & github,
        ]
      '';
    };

    "midnight-wallet/publish" = {
      task = "publish";
      io = ''
        let push = {
          #lib.io.github_push
          #input: "GitHub tag pushed"
          #repo: "input-output-hk/midnight-wallet"
          #tag: ".*"
          inputs: _final_inputs
        }
        _final_inputs: inputs
        inputs: {
          push.inputs
          "CI passed": match: {
            ok: true
            revision: push._revision
          }
        }
        output: {
          success: published: true
          failure: published: false
          [string]: revision: push._revision
        }
      '';
    };
}