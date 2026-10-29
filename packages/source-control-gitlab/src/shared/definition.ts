import {
  makeProviderSettingsSchema,
  secretSetting,
  SourceControlProviderKind,
  TrimmedString,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  changeRequestUrlBelow,
  defineSourceControl,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  parseChangeRequestPath,
  projectChangeRequestHost,
} from "@t3tools/source-control-core/shared/definition";
import { icon } from "./icon.ts";

const CHECKOUT_COMMAND = /^glab\s+mr\s+checkout\s+(.+)$/i;
// `/-/merge_requests/` is GitLab's own route, so a self-hosted server is recognized by it
// whatever its hostname.
const CHANGE_REQUEST_REFERENCE =
  /^https?:\/\/[^/?#\s]+\/[^/?#\s]+(?:\/[^/?#\s]+)+\/-\/merge_requests\/(\d+)(?:[/?#].*)?$/i;

// Self-managed GitLab runs on any hostname and nests projects in groups.
const CHANGE_REQUEST_PATH = /^\/([^/]+(?:\/[^/]+)+)\/-\/merge_requests\/(\d+)(?:\/|$)/u;

const KIND = SourceControlProviderKind.make("gitlab");

export const settings = makeProviderSettingsSchema(
  {
    host: TrimmedString.pipe(
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Server",
        description:
          "Your self-hosted GitLab, such as gitlab.example.com. Leave empty for gitlab.com.",
        providerSettingsForm: { placeholder: "gitlab.com" },
      }),
    ),
    token: TrimmedString.pipe(
      secretSetting,
      Schema.withDecodingDefault(Effect.succeed("")),
      Schema.annotateKey({
        title: "Access token",
        description:
          "A personal, group, or project access token with the api scope. Used for that server before the glab login.",
        providerSettingsForm: { control: "password" },
      }),
    ),
  },
  { order: ["host", "token"] },
);
export type GitLabSettings = typeof settings.Type;

/**
 * The saved server as an authority (`host[:port]`), lower case, from whatever the reader typed:
 * a bare name, a URL, or a URL with a path. Empty means gitlab.com.
 */
export function gitLabSettingsAuthority(saved: GitLabSettings): string {
  const raw = saved.host.trim();
  if (raw.length === 0) return "gitlab.com";
  try {
    return new URL(
      /^[a-z][a-z0-9+.-]*:\/\//iu.test(raw) ? raw : `https://${raw}`,
    ).host.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/** A repository's host carries no port, so servers are matched by name alone. */
export function gitLabHostname(authority: string): string {
  try {
    return new URL(`https://${authority}`).hostname.toLowerCase();
  } catch {
    return authority.toLowerCase();
  }
}

export const definition = defineSourceControl({
  kind: KIND,
  label: "GitLab",
  pickerLabel: "GitLab",
  icon,
  changeRequest: {
    shortLabel: "MR",
    shortLabelWithArticle: "an MR",
    singular: "merge request",
    plural: "merge requests",
  },
  repositoryPathHint: "group/project",
  publicHost: "gitlab.com",
  publishDescription: "gitlab.com",
  publishHost: () => "gitlab.com",
  newRepositoryOwner: (account) => ({ owner: account }),
  defaultCloneTransport: "ssh",
  changeRequestUrl: ({ host, repository, number, webUrl }) =>
    webUrl
      ? changeRequestUrlBelow(webUrl, `-/merge_requests/${number}`)
      : `https://${host}/${repository}/-/merge_requests/${number}`,
  parseChangeRequestUrl: (url) => parseChangeRequestPath(url, CHANGE_REQUEST_PATH),
  changeRequestUrlFromReferenceAutolink: () => null,
  changeRequestActions: new Set([
    "merge",
    "ready",
    "draft",
    "close",
    "reopen",
    "delete-branch",
    "update-branch",
    "enable-auto-merge",
    "disable-auto-merge",
    "unapprove",
  ] as const),
  checkoutCommand: ({ number }) => `glab mr checkout ${number}`,
  changeRequestCloseCommand: /\bglab\s+mr\s+(?:merge|close)\b/u,
  changeRequestCreateCommand: /\bglab\s+mr\s+create\b/u,
  authorProfileUrl: () => null,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: (input) => CHECKOUT_COMMAND.exec(input)?.[1]?.trim() ?? null,
  isChangeRequestReference: (url) => CHANGE_REQUEST_REFERENCE.test(url),
  checkoutChangeRequestHost: () => null,
  changeRequestHeadRef: (number) => `refs/merge-requests/${number}/head`,
  recognizeRemote: ({ host, hostname }) =>
    hostname === "gitlab.com" || hostname.split(".").includes("gitlab")
      ? {
          kind: KIND,
          name: hostname === "gitlab.com" ? "GitLab" : "GitLab Self-Hosted",
          baseUrl: `https://${host}`,
        }
      : null,
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(projectChangeRequestHost(identity, KIND), identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(projectChangeRequestHost(identity, KIND), identity, link),
  settings,
});
