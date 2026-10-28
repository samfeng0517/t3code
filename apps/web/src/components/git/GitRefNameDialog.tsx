import { useId, useState } from "react";

import { useT } from "~/i18n";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { validateGitRefName } from "./gitRefName";

export type GitRefNameRequest =
  | { readonly kind: "create-branch" }
  | { readonly kind: "create-tag" }
  | { readonly kind: "rename"; readonly name: string };

export interface GitRefNameChoice {
  readonly name: string;
  /** Only meaningful for `create-branch`. */
  readonly switchRef: boolean;
}

/** Asks for a branch or tag name, rejecting names git would refuse as the user types. */
export function GitRefNameDialog(props: {
  readonly request: GitRefNameRequest;
  /** Another write holds the page's lock; submitting now would be dropped, so it waits here. */
  readonly pending: boolean;
  readonly onFinish: (choice: GitRefNameChoice | null) => void;
}) {
  const t = useT();
  const id = useId();
  const { request, onFinish } = props;
  const [name, setName] = useState("");
  const [switchRef, setSwitchRef] = useState(true);
  const validation = validateGitRefName(name);
  const canSubmit = validation === null && !props.pending;

  const title =
    request.kind === "create-branch"
      ? t("git.dialog.createBranch")
      : request.kind === "create-tag"
        ? t("git.dialog.createTag")
        : t("git.dialog.renameBranch", { name: request.name });

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
            if (canSubmit) onFinish({ name, switchRef });
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${id}-name`}>{t("git.dialog.name")}</Label>
                <Input
                  nativeInput
                  id={`${id}-name`}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={validation === "invalid" || undefined}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                {validation === "invalid" ? (
                  <p role="alert" className="text-xs text-destructive-foreground">
                    {t("git.dialog.invalidName")}
                  </p>
                ) : null}
              </div>
              {request.kind === "create-branch" ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`${id}-switch`}
                    checked={switchRef}
                    onCheckedChange={(checked) => setSwitchRef(checked)}
                  />
                  <Label htmlFor={`${id}-switch`}>{t("git.dialog.switchToNewBranch")}</Label>
                </div>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onFinish(null)}>
              {t("git.dialog.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {request.kind === "rename" ? t("git.dialog.rename") : t("git.dialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
