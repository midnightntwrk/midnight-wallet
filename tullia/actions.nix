{
  "midnight-wallet/ci" = {
    task = "CI";
    io = ''
      let github = {
        #input: "GitHub Push or PR"
        #repo: "input-output-hk/midnight-wallet"
      }

      let push = {
        #lib.io.github_push
        #default_branch: true
        #tag: ".*"
        github
      }

      let pr = #lib.io.github_pr & github

      #lib.merge
      #ios: [push, pr]
      inputs: "commit already built": {
        not: true
        match: {
          _deps: inputs[github.#input]
          if (push._revision | pr._revision) == _|_ {close({})}
          if (push._revision | pr._revision) != _|_ {
            ok: bool
            revision: push._revision | pr._revision
          }
        }
      }
    '';
  };

  "midnight-wallet/publish" = {
    task = "CD";
    io = ''
      let push = {
        #lib.io.github_push
        #input: "GitHub Tag"
        #repo: "input-output-hk/midnight-wallet"
        #tag: ".*"
      }

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
        [string]: {
          revision: push._revision
          tag: push._tag
        }
      }
    '';
  };
}
