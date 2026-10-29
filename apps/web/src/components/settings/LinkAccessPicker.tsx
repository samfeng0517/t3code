import { AuthMcpClientAccess } from "@t3tools/contracts";
import { useId } from "react";

import { useT } from "~/i18n";
import { accessPresentation } from "../auth/ConnectAgentSurface";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

/** What agents here may do in an environment being linked, with what that does not allow. */
export function LinkAccessPicker({
  value,
  onChange,
  disabled = false,
}: {
  readonly value: AuthMcpClientAccess;
  readonly onChange: (access: AuthMcpClientAccess) => void;
  readonly disabled?: boolean;
}) {
  const t = useT();
  const labelId = useId();
  const selected = accessPresentation(value, t);
  return (
    <div className="space-y-1.5">
      <span id={labelId} className="block text-xs font-medium">
        {t("settingsMisc.link.access.label")}
      </span>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) onChange(next as AuthMcpClientAccess);
        }}
      >
        <SelectTrigger aria-labelledby={labelId}>
          <SelectValue>
            <span className="flex items-center gap-2">
              <selected.icon aria-hidden className="size-4" />
              {selected.label}
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          {AuthMcpClientAccess.literals.map((option) => {
            const { label, description, icon: Icon } = accessPresentation(option, t);
            return (
              <SelectItem key={option} value={option} hideIndicator>
                <span className="grid min-w-0 gap-0.5 py-0.5">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                    {label}
                  </span>
                  <span className="text-xs leading-4 text-muted-foreground">{description}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectPopup>
      </Select>
      <p className="text-xs text-muted-foreground">
        {t("settingsMisc.link.access.note", { description: selected.description })}
      </p>
    </div>
  );
}
