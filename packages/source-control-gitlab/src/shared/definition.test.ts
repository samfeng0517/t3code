import { normalizeGitRemoteUrl } from "@t3tools/shared/git";
import {
  projectChangeRequestHost,
  recognizeRemoteWith,
} from "@t3tools/source-control-core/shared/definition";
import { describe, expect, it } from "vite-plus/test";

import { definition, gitLabSettingsAuthority } from "./definition.ts";

const parse = (url: string) => definition.parseChangeRequestUrl(new URL(url));

describe("GitLab change request URLs", () => {
  it("reads a merge request on any host, nested groups and all", () => {
    expect(parse("https://gitlab.com/t3tools/platform/t3code/-/merge_requests/42")).toEqual({
      host: "gitlab.com",
      repository: "t3tools/platform/t3code",
      number: 42,
      repositoryUrl: "https://gitlab.com/t3tools/platform/t3code",
    });
    expect(parse("https://code.acme.test/team/project/-/merge_requests/9")).toMatchObject({
      host: "code.acme.test",
      repository: "team/project",
      number: 9,
    });
  });

  it("keeps pull-like segments inside nested repository paths", () => {
    expect(
      parse("https://gitlab.example.test/group/pull/123/repo/-/merge_requests/42")?.repositoryUrl,
    ).toBe("https://gitlab.example.test/group/pull/123/repo");
  });

  it("leaves issues and single-segment paths alone", () => {
    expect(parse("https://gitlab.com/t3tools/t3code/-/issues/12")).toBeNull();
    expect(parse("https://gitlab.com/t3code/-/merge_requests/12")).toBeNull();
  });

  it("recognizes only merge request URLs it can parse", () => {
    for (const url of [
      "https://gitlab.com/g/p?x=/-/merge_requests/5",
      "https://gitlab.com/g/p#/-/merge_requests/5",
      "https://gitlab.com?x=/g/p/-/merge_requests/5",
      "https://gitlab.com#/g/p/-/merge_requests/5",
      "https://gitlab.com/t3code/-/merge_requests/12",
      "https://gitlab.com/g//-/merge_requests/5",
    ]) {
      expect(definition.isChangeRequestReference(url), url).toBe(false);
      expect(parse(url), url).toBeNull();
    }
    for (const url of [
      "https://code.acme.test/a/b/c/-/merge_requests/7?tab=diffs",
      "http://git.internal/a/b/c/-/merge_requests/7#note_1",
      "https://code.acme.test/a/b/c/-/merge_requests/7/diffs",
    ]) {
      expect(definition.isChangeRequestReference(url), url).toBe(true);
      expect(parse(url), url).toMatchObject({ repository: "a/b/c", number: 7 });
    }
  });

  it("builds merge request URLs below the repository", () => {
    expect(
      definition.changeRequestUrl({
        host: "gitlab.com",
        repository: "group/sub/project",
        number: 4,
      }),
    ).toBe("https://gitlab.com/group/sub/project/-/merge_requests/4");
    expect(
      definition.changeRequestUrl({
        host: "gitlab.com",
        repository: "group/sub/project",
        number: 4,
        webUrl: "https://gitlab.com/group/sub/project",
      }),
    ).toBe("https://gitlab.com/group/sub/project/-/merge_requests/4");
  });
});

describe("GitLab remotes", () => {
  const recognize = (url: string) => recognizeRemoteWith(definition, url);

  it("keeps an HTTP port in the base URL and drops an SSH one", () => {
    expect(recognize("https://gitlab.com:8443/group/repo.git")).toEqual({
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.com:8443",
    });
    expect(recognize("ssh://git@gitlab.example.test:24/group/repo.git")).toEqual({
      kind: "gitlab",
      name: "GitLab Self-Hosted",
      baseUrl: "https://gitlab.example.test",
    });
    expect(recognize("gitlab@gitlab.example.com:group/project.git")?.baseUrl).toBe(
      "https://gitlab.example.com",
    );
  });

  it("matches complete DNS labels only", () => {
    expect(recognize("https://notgitlab.example.com/group/repo.git")).toBeNull();
  });
});

const MERGE_REQUEST_URL = "https://gitlab.example.com/sam/t3code/-/merge_requests/42";

describe.each([
  "https://gitlab.example.com/sam/t3code.git",
  "git@gitlab.example.com:sam/t3code.git",
])("a self-hosted GitLab checkout from %s", (remoteUrl) => {
  const identity = {
    canonicalKey: normalizeGitRemoteUrl(remoteUrl),
    locator: { source: "git-remote" as const, remoteName: "origin", remoteUrl },
    displayName: "sam/t3code",
    owner: "sam",
    name: "t3code",
  };

  it("should detect GitLab on its own server when the remote names it", () => {
    expect(recognizeRemoteWith(definition, remoteUrl)).toEqual({
      kind: "gitlab",
      name: "GitLab Self-Hosted",
      baseUrl: "https://gitlab.example.com",
    });
    expect(identity.canonicalKey).toBe("gitlab.example.com/sam/t3code");
    expect(projectChangeRequestHost(identity, definition.kind)).toBe("gitlab.example.com");
  });

  it("should build merge request links on that server when the checkout is self-hosted", () => {
    const link = parse(MERGE_REQUEST_URL);
    expect(link).toMatchObject({
      host: "gitlab.example.com",
      repository: "sam/t3code",
      number: 42,
    });
    expect(
      definition.changeRequestUrl({
        host: "gitlab.example.com",
        repository: "sam/t3code",
        number: 42,
      }),
    ).toBe(MERGE_REQUEST_URL);
    expect(definition.isChangeRequestInRepository(identity, link!)).toBe(true);
    expect(definition.canReadChangeRequestOnHost(identity, link!)).toBe(true);
    expect(
      definition.canReadChangeRequestOnHost(identity, {
        host: "gitlab.com",
        repository: "sam/t3code",
        number: 42,
      }),
    ).toBe(false);
  });
});

describe("merge request references", () => {
  it("should recognize a merge request on any server when it uses GitLab's own route", () => {
    expect(definition.isChangeRequestReference(MERGE_REQUEST_URL)).toBe(true);
    expect(
      definition.isChangeRequestReference("https://code.example.com/team/app/-/merge_requests/7"),
    ).toBe(true);
    expect(definition.isChangeRequestReference("https://code.example.com/team/app/pull/7")).toBe(
      false,
    );
    expect(definition.checkoutCommandArgument("glab mr checkout 42")).toBe("42");
  });
});

describe("gitLabSettingsAuthority", () => {
  const authority = (host: string) => gitLabSettingsAuthority({ host, token: "" });

  it("should read the server when it is typed as a name, URL, or URL with a path", () => {
    expect(authority("gitlab.example.com")).toBe("gitlab.example.com");
    expect(authority("https://GitLab.Example.com/")).toBe("gitlab.example.com");
    expect(authority("https://gitlab.example.com:8443/some/path")).toBe("gitlab.example.com:8443");
    expect(authority("")).toBe("gitlab.com");
  });
});
