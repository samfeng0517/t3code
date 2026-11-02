import { useId, useState } from "react";

import { useT } from "~/i18n";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

/** Asks for an optional stash message; leaving it empty keeps git's default shown as the placeholder. */
export function GitStashDialog(props: {
  readonly placeholder: string;
  /** Another write holds the page's lock; submitting now would be dropped, so it waits here. */
  readonly pending: boolean;
  readonly onFinish: (message: string | null) => void;
}) {
  const t = useT();
  const id = useId();
  const { onFinish } = props;
  const [message, setMessage] = useState("");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onFinish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!props.pending) onFinish(message);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("git.dialog.stashTitle")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-message`}>{t("git.dialog.stashMessage")}</Label>
              <Input
                nativeInput
                id={`${id}-message`}
                autoFocus
                autoComplete="off"
                placeholder={props.placeholder}
                aria-describedby={`${id}-hint`}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
              <p id={`${id}-hint`} className="text-xs text-muted-foreground">
                {t("git.dialog.stashHint")}
              </p>
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onFinish(null)}>
              {t("git.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={props.pending}>
              {t("git.dialog.stash")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
