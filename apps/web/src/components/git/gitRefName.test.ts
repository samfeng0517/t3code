import { describe, expect, it } from "vite-plus/test";

import { validateGitRefName } from "./gitRefName";

describe("validateGitRefName", () => {
  it("validateGitRefName should return invalid when the name contains a double dot", () => {
    expect(validateGitRefName("fix..login")).toBe("invalid");
  });

  it("validateGitRefName should return invalid when it ends with .lock", () => {
    expect(validateGitRefName("fix/login.lock")).toBe("invalid");
  });

  it("validateGitRefName should return invalid when it starts with a dash", () => {
    expect(validateGitRefName("-fix")).toBe("invalid");
  });

  it("validateGitRefName should return invalid when a middle component ends with .lock", () => {
    expect(validateGitRefName("fix.lock/login")).toBe("invalid");
  });

  it("validateGitRefName should return null when the name is fix/login", () => {
    expect(validateGitRefName("fix/login")).toBeNull();
  });

  it("validateGitRefName should return empty when the name is empty", () => {
    expect(validateGitRefName("")).toBe("empty");
  });

  it("validateGitRefName should return invalid when the name breaks another check-ref-format rule", () => {
    for (const name of [
      "/fix",
      "fix/",
      "fix.",
      "fix//login",
      "fix@{1}",
      "@",
      "fix login",
      "fix\u0007",
      "fix~1",
      "fix^",
      "fix:login",
      "fix?",
      "fix*",
      "fix[",
      "fix\\login",
      "fix/.login",
      ".fix",
    ]) {
      expect(validateGitRefName(name), name).toBe("invalid");
    }
  });
});
