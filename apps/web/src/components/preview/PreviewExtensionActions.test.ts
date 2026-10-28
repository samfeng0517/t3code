import type { DesktopPreviewWebviewConfig } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { extensionToolbarPartition, shouldHideExtensionActions } from "./PreviewExtensionActions";

const makeConfig = (partition: string): DesktopPreviewWebviewConfig => ({
  partition,
  webPreferences: "sandbox=yes",
  preloadUrl: null,
});

describe("extensionToolbarPartition", () => {
  it("extensionToolbarPartition should return the partition when it is persistent", () => {
    expect(extensionToolbarPartition(makeConfig("persist:t3code-preview-default"))).toBe(
      "persist:t3code-preview-default",
    );
  });

  it("extensionToolbarPartition should return null when the partition is incognito", () => {
    expect(extensionToolbarPartition(makeConfig("t3code-preview-ephemeral-abc"))).toBeNull();
  });

  it("extensionToolbarPartition should return null when the config has not loaded", () => {
    expect(extensionToolbarPartition(null)).toBeNull();
  });
});

// Widths as measured in the desktop row: each icon adds its 24 wide button plus
// the row's 4 gap, and the address field must keep 140 (10em at 14).
const ICON = 28;
const MIN = 140;

describe("shouldHideExtensionActions", () => {
  it("shouldHideExtensionActions should keep the group shown when there are no extension icons", () => {
    expect(
      shouldHideExtensionActions({
        fieldWidth: 20,
        groupWidth: 0,
        hidden: false,
        minFieldWidth: MIN,
      }),
    ).toBe(false);
  });

  it("shouldHideExtensionActions should keep the group shown when the field stays above the minimum beside it", () => {
    // Default 540 panel with 2 icons: the field is 331 without them.
    expect(
      shouldHideExtensionActions({
        fieldWidth: 331 - 2 * ICON,
        groupWidth: 2 * ICON,
        hidden: false,
        minFieldWidth: MIN,
      }),
    ).toBe(false);
  });

  it("shouldHideExtensionActions should hide the group when enough icons squeeze the field below the minimum", () => {
    // Same 540 panel with 8 icons: the field shrinks to 107.
    expect(
      shouldHideExtensionActions({
        fieldWidth: 331 - 8 * ICON,
        groupWidth: 8 * ICON,
        hidden: false,
        minFieldWidth: MIN,
      }),
    ).toBe(true);
  });

  it("shouldHideExtensionActions should hide the group when a leading profile badge narrows the field", () => {
    // 464 panel with the profile badge and 2 icons: the field is 140 without them.
    expect(
      shouldHideExtensionActions({
        fieldWidth: 140 - 2 * ICON,
        groupWidth: 2 * ICON,
        hidden: false,
        minFieldWidth: MIN,
      }),
    ).toBe(true);
  });

  it("shouldHideExtensionActions should show the group again when the hidden field has room for the icons and the minimum", () => {
    expect(
      shouldHideExtensionActions({
        fieldWidth: MIN + 2 * ICON + 10,
        groupWidth: 2 * ICON,
        hidden: true,
        minFieldWidth: MIN,
      }),
    ).toBe(false);
  });

  it("shouldHideExtensionActions should stay hidden when the hidden field is still too narrow for the icons", () => {
    expect(
      shouldHideExtensionActions({
        fieldWidth: MIN + 2 * ICON - 10,
        groupWidth: 2 * ICON,
        hidden: true,
        minFieldWidth: MIN,
      }),
    ).toBe(true);
  });

  it("shouldHideExtensionActions should stay hidden when rounding puts the hidden field exactly on the boundary", () => {
    // Hiding at a shown field of MIN - 0.01 can measure exactly MIN + group once hidden.
    expect(
      shouldHideExtensionActions({
        fieldWidth: MIN + 2 * ICON,
        groupWidth: 2 * ICON,
        hidden: true,
        minFieldWidth: MIN,
      }),
    ).toBe(true);
  });

  it("shouldHideExtensionActions should not flip back when the toggled layout is measured again", () => {
    const groupWidth = 3 * ICON;
    for (let widthWithoutIcons = 150; widthWithoutIcons <= 300; widthWithoutIcons += 0.25) {
      const shownField = widthWithoutIcons - groupWidth;
      const fromShown = shouldHideExtensionActions({
        fieldWidth: shownField,
        groupWidth,
        hidden: false,
        minFieldWidth: MIN,
      });
      const afterToggle = shouldHideExtensionActions({
        fieldWidth: fromShown ? widthWithoutIcons : shownField,
        groupWidth,
        hidden: fromShown,
        minFieldWidth: MIN,
      });
      expect(afterToggle).toBe(fromShown);

      const fromHidden = shouldHideExtensionActions({
        fieldWidth: widthWithoutIcons,
        groupWidth,
        hidden: true,
        minFieldWidth: MIN,
      });
      const afterReveal = shouldHideExtensionActions({
        fieldWidth: fromHidden ? widthWithoutIcons : shownField,
        groupWidth,
        hidden: fromHidden,
        minFieldWidth: MIN,
      });
      expect(afterReveal).toBe(fromHidden);
    }
  });
});
