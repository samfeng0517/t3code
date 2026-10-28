import { Star } from "lucide-react";

import { useIsUrlBookmarked } from "~/browserBookmarksStore";
import { useT } from "~/i18n";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { toggleBookmarkForUrl } from "./browserBookmarkActions";

/** The address bar star; subscribes to the bookmarks itself so the toolbar does not. */
export function PreviewBookmarkButton(props: { readonly url: string; readonly title: string }) {
  const t = useT();
  const bookmarked = useIsUrlBookmarked(props.url);
  const label = t(bookmarked ? "browser.bookmarks.remove" : "browser.bookmarks.add");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            aria-label={label}
            aria-pressed={bookmarked ? "true" : "false"}
            onClick={() => toggleBookmarkForUrl({ ...props, bookmarked })}
          />
        }
      >
        <Star className={cn(bookmarked && "fill-current text-primary")} />
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
