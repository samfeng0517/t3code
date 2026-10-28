import { assert, describe, it } from "@effect/vitest";

import { worktreeBaseWarningDetail } from "./worktreeBaseWarning.ts";

describe("worktreeBaseWarningDetail", () => {
  it("worktreeBaseWarningDetail should render each warning kind with the remote name when given any warning kind", () => {
    assert.equal(
      worktreeBaseWarningDetail({ kind: "fetch-failed", remoteName: "origin", localRef: "main" }),
      "Couldn't reach origin; used local main",
    );
    assert.equal(
      worktreeBaseWarningDetail({ kind: "diverged", remoteRef: "upstream/main", branch: "main" }),
      "main diverged from upstream/main; not updated",
    );
    assert.equal(
      worktreeBaseWarningDetail({
        kind: "fast-forward-blocked",
        remoteName: "upstream",
        branch: "feature",
      }),
      "Couldn't fast-forward feature to upstream; not updated",
    );
  });

  it("worktreeBaseWarningDetail should name the compared remote branch when the upstream has a different name", () => {
    assert.equal(
      worktreeBaseWarningDetail({ kind: "diverged", remoteRef: "origin/main", branch: "feat" }),
      "feat diverged from origin/main; not updated",
    );
  });
});
