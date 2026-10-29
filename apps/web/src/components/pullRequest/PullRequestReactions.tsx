import { useAtomCommand } from "~/state/use-atom-command";
import type {
  EnvironmentId,
  PullRequestReaction,
  PullRequestReactionContent,
  PullRequestRef,
} from "@t3tools/contracts";
import { SmilePlusIcon } from "lucide-react";
import { useState } from "react";

import { useT, type MessageKey, type Translate } from "~/i18n";
import { cn } from "~/lib/utils";
import { pullRequestEnvironment } from "~/state/pullRequests";

import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  applyPendingPullRequestReactions,
  PULL_REQUEST_REACTION_ORDER,
  pullRequestReactionEmoji,
  pullRequestReactionsSignature,
} from "@t3tools/client-runtime/pull-request-reactions";

const PILL_CLASS =
  "inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const EMPTY_PENDING: ReadonlyMap<PullRequestReactionContent, boolean> = new Map();

const REACTION_NAME_KEYS: Record<PullRequestReactionContent, MessageKey> = {
  "thumbs-up": "pullRequestDetail.reactions.name.thumbs-up",
  "thumbs-down": "pullRequestDetail.reactions.name.thumbs-down",
  laugh: "pullRequestDetail.reactions.name.laugh",
  hooray: "pullRequestDetail.reactions.name.hooray",
  confused: "pullRequestDetail.reactions.name.confused",
  heart: "pullRequestDetail.reactions.name.heart",
  rocket: "pullRequestDetail.reactions.name.rocket",
  eyes: "pullRequestDetail.reactions.name.eyes",
};

const NAMED_ACTOR_LIMIT = 3;

function joinNames(parts: ReadonlyArray<string>, t: Translate): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) {
    return t("pullRequestDetail.reactions.joinTwo", {
      first: parts[0] ?? "",
      second: parts[1] ?? "",
    });
  }
  return t("pullRequestDetail.reactions.joinMany", {
    head: parts.slice(0, -1).join(t("pullRequestDetail.reactions.separator")),
    last: parts.at(-1) ?? "",
  });
}

function countRemainder(count: number, named: boolean, t: Translate): string {
  if (named) {
    return t(
      count === 1
        ? "pullRequestDetail.reactions.otherOne"
        : "pullRequestDetail.reactions.otherMany",
      { count },
    );
  }
  return t(
    count === 1
      ? "pullRequestDetail.reactions.personOne"
      : "pullRequestDetail.reactions.personMany",
    { count },
  );
}

function reactionTooltip(reaction: PullRequestReaction, t: Translate): string {
  const viewerHasRoom = reaction.actors.length < reaction.count;
  const names =
    reaction.viewerHasReacted && viewerHasRoom
      ? [t("pullRequestDetail.reactions.you"), ...reaction.actors]
      : [...reaction.actors];
  const shown = names.slice(0, Math.min(NAMED_ACTOR_LIMIT, reaction.count));
  const others = Math.max(0, reaction.count - shown.length);
  const parts = [...shown, ...(others > 0 ? [countRemainder(others, shown.length > 0, t)] : [])];
  return t("pullRequestDetail.reactions.tooltip", {
    names: joinNames(parts, t),
    reaction: t(REACTION_NAME_KEYS[reaction.content]),
  });
}

export function PullRequestReactionBar({
  reactions,
  canReact,
  subjectId,
  environmentId,
  reference,
  onRefresh,
  className,
}: {
  readonly reactions: ReadonlyArray<PullRequestReaction>;
  readonly canReact: boolean;
  /** Omit to react to the pull request description. */
  readonly subjectId?: string | undefined;
  readonly environmentId: EnvironmentId;
  readonly reference: PullRequestRef;
  readonly onRefresh: () => void;
  readonly className?: string | undefined;
}) {
  const t = useT();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{
    readonly signature: string;
    readonly values: ReadonlyMap<PullRequestReactionContent, boolean>;
  }>({ signature: "", values: EMPTY_PENDING });
  const setReaction = useAtomCommand(pullRequestEnvironment.setReaction, {
    reportFailure: false,
  });

  const signature = pullRequestReactionsSignature(reactions);
  const values = pending.signature === signature ? pending.values : EMPTY_PENDING;
  const shown = applyPendingPullRequestReactions(reactions, values);

  const toggle = async (content: PullRequestReactionContent, reacted: boolean) => {
    setPending({ signature, values: new Map([...values, [content, reacted]]) });
    const result = await setReaction({
      environmentId,
      input: {
        ...reference,
        ...(subjectId === undefined ? {} : { subjectId }),
        content,
        reacted,
      },
    });
    if (result._tag === "Failure") {
      setPending((current) => {
        const next = new Map(current.values);
        next.delete(content);
        return { signature: current.signature, values: next };
      });
      toastManager.add({ type: "error", title: t("pullRequestDetail.reactions.saveFailed") });
      return;
    }
    onRefresh();
  };

  if (shown.length === 0 && !canReact) return null;

  return (
    <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-1", className)}>
      {shown.map((reaction) => (
        <Tooltip key={reaction.content}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={reaction.viewerHasReacted}
                aria-label={t("pullRequestDetail.reactions.countAria", {
                  name: t(REACTION_NAME_KEYS[reaction.content]),
                  count: reaction.count,
                })}
                disabled={!canReact}
                className={cn(
                  PILL_CLASS,
                  reaction.viewerHasReacted
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/70 bg-muted/40 text-muted-foreground",
                  canReact ? "hover:border-primary/60" : "cursor-default",
                )}
                onClick={() => void toggle(reaction.content, !reaction.viewerHasReacted)}
              />
            }
          >
            <span aria-hidden>{pullRequestReactionEmoji(reaction.content)}</span>
            <span className="tabular-nums">{reaction.count}</span>
          </TooltipTrigger>
          <TooltipPopup side="top">{reactionTooltip(reaction, t)}</TooltipPopup>
        </Tooltip>
      ))}

      {canReact ? (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                aria-label={t("pullRequestDetail.reactions.add")}
                className={cn(
                  PILL_CLASS,
                  "border-border/70 px-1.5 text-muted-foreground hover:border-primary/60 hover:text-foreground",
                )}
              />
            }
          >
            <SmilePlusIcon aria-hidden className="size-3.5" />
          </PopoverTrigger>
          <PopoverPopup align="start" side="top" padding="compact">
            <div className="flex items-center gap-0.5">
              {PULL_REQUEST_REACTION_ORDER.map((content) => {
                const reacted =
                  shown.find((reaction) => reaction.content === content)?.viewerHasReacted ?? false;
                return (
                  <button
                    key={content}
                    type="button"
                    aria-pressed={reacted}
                    aria-label={t(REACTION_NAME_KEYS[content])}
                    className={cn(
                      "flex size-7 items-center justify-center rounded-md text-base outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      reacted && "bg-primary/10",
                    )}
                    onClick={() => {
                      setPickerOpen(false);
                      void toggle(content, !reacted);
                    }}
                  >
                    <span aria-hidden>{pullRequestReactionEmoji(content)}</span>
                  </button>
                );
              })}
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}
