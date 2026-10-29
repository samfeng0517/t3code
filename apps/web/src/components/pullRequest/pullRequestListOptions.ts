import type { PullRequestInvolvement, PullRequestListState } from "@t3tools/contracts";
import {
  CalendarArrowDownIcon,
  CalendarArrowUpIcon,
  ClockIcon,
  EyeIcon,
  LayersIcon,
  ListChecksIcon,
  Maximize2Icon,
  Minimize2Icon,
  PenLineIcon,
  UserLockIcon,
} from "lucide-react";

import type { MessageKey, Translate } from "~/i18n";

import type { PullRequestFilterOption } from "./PullRequestListFilters";
import type { PullRequestListSort } from "./pullRequestListPreferences";
import { PullRequestGlyph } from "./pullRequestIcons";

export type PullRequestFilterOptionSpec<Value extends string> = Omit<
  PullRequestFilterOption<Value>,
  "label"
> & { readonly labelKey: MessageKey };

export function localizePullRequestFilterOptions<Value extends string>(
  options: ReadonlyArray<PullRequestFilterOptionSpec<Value>>,
  t: Translate,
): ReadonlyArray<PullRequestFilterOption<Value>> {
  return options.map(({ labelKey, ...option }) => ({ ...option, label: t(labelKey) }));
}

export const INVOLVEMENT_TABS = [
  { value: "all", labelKey: "pullRequests.options.involvement.all", Icon: LayersIcon },
  { value: "reviewing", labelKey: "pullRequests.options.involvement.reviewing", Icon: EyeIcon },
  { value: "authored", labelKey: "pullRequests.options.involvement.authored", Icon: PenLineIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOptionSpec<PullRequestInvolvement>>;

export const STATE_TABS = [
  { value: "all", labelKey: "pullRequests.options.state.all", Icon: LayersIcon },
  {
    value: "open",
    labelKey: "pullRequests.options.state.open",
    Icon: PullRequestGlyph.pullRequest,
  },
  { value: "closed", labelKey: "pullRequests.options.state.closed", Icon: PullRequestGlyph.closed },
  { value: "merged", labelKey: "pullRequests.options.state.merged", Icon: PullRequestGlyph.merged },
] as const satisfies ReadonlyArray<PullRequestFilterOptionSpec<PullRequestListState>>;

export const SORT_OPTIONS = [
  { value: "ready", labelKey: "pullRequests.options.sort.ready", Icon: ListChecksIcon },
  { value: "blocked", labelKey: "pullRequests.options.sort.blocked", Icon: UserLockIcon },
  { value: "updated", labelKey: "pullRequests.options.sort.updated", Icon: ClockIcon },
  { value: "newest", labelKey: "pullRequests.options.sort.newest", Icon: CalendarArrowDownIcon },
  { value: "oldest", labelKey: "pullRequests.options.sort.oldest", Icon: CalendarArrowUpIcon },
  { value: "largest", labelKey: "pullRequests.options.sort.largest", Icon: Maximize2Icon },
  { value: "smallest", labelKey: "pullRequests.options.sort.smallest", Icon: Minimize2Icon },
] as const satisfies ReadonlyArray<PullRequestFilterOptionSpec<PullRequestListSort>>;
