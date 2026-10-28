import type { ModSurfaceSite, ModUiNode } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";

import { ModSite } from "./ModUiTree";
import type { ModActions } from "./useModActions";

const site: ModSurfaceSite = { component: "Pane", paneId: "demo" };

function setup(enabled = true): ModActions {
  return {
    canAct: enabled,
    canEdit: enabled,
    press: vi.fn<ModActions["press"]>(),
    pick: vi.fn<ModActions["pick"]>(),
    edit: vi.fn<ModActions["edit"]>(),
    closePane: vi.fn<ModActions["closePane"]>(),
  };
}

const field = (key: string, autoFocus?: true): ModUiNode => ({
  type: "input",
  key,
  plugin: "demo",
  handle: 1,
  value: "",
  label: key,
  ...(autoFocus ? { autoFocus } : {}),
});

const column = (...children: ReadonlyArray<ModUiNode>): ModUiNode => ({
  type: "box",
  direction: "column",
  children,
});

function Surface(props: {
  readonly node: ModUiNode;
  readonly visible: boolean;
  readonly enabled?: boolean;
}) {
  return (
    <>
      <input aria-label="Composer" />
      <button type="button">Elsewhere</button>
      <ModSite
        node={props.node}
        site={site}
        actions={setup(props.enabled)}
        visible={props.visible}
      />
    </>
  );
}

describe("ModSite autofocus", () => {
  it("focuses the first autofocus control once, when it is first drawn", async () => {
    await using screen = await render(<Surface node={column(field("name"))} visible />);
    await expect.element(screen.getByLabelText("name")).not.toHaveFocus();

    await screen.rerender(
      <Surface node={column(field("name"), field("email", true), field("note", true))} visible />,
    );
    await expect.element(screen.getByLabelText("email")).toHaveFocus();

    // The site had its one autofocus: a later drawing that asks again does not
    // take the focus back from outside it.
    await screen.rerender(<Surface node={column(field("name"))} visible />);
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
    await screen.rerender(<Surface node={column(field("name"), field("email", true))} visible />);
    await expect.element(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("keeps its one autofocus for when the control is enabled", async () => {
    await using screen = await render(
      <Surface node={column(field("email", true))} visible enabled={false} />,
    );
    await expect.element(screen.getByLabelText("email")).toBeDisabled();

    await screen.rerender(<Surface node={column(field("email", true))} visible />);
    await expect.element(screen.getByLabelText("email")).toHaveFocus();
  });

  it("waits until the pane shows", async () => {
    await using screen = await render(
      <Surface node={column(field("email", true))} visible={false} />,
    );
    await expect.element(screen.getByLabelText("email")).not.toHaveFocus();

    await screen.rerender(<Surface node={column(field("email", true))} visible />);
    await expect.element(screen.getByLabelText("email")).toHaveFocus();
  });

  it("focuses a picker the mod marked", async () => {
    await using screen = await render(
      <Surface
        node={column({
          type: "select",
          key: "env",
          label: "Environment",
          plugin: "demo",
          handle: 2,
          options: [{ value: "dev" }],
          autoFocus: true,
        })}
        visible
      />,
    );
    await expect.element(screen.getByLabelText("Environment", { exact: true })).toHaveFocus();
  });

  it("never takes the keyboard from a field the person is typing in elsewhere", async () => {
    await using screen = await render(<Surface node={column(field("name"))} visible />);
    await userEvent.click(screen.getByLabelText("Composer"));

    await screen.rerender(<Surface node={column(field("email", true))} visible />);
    await expect.element(screen.getByLabelText("Composer")).toHaveFocus();
  });
});

describe("ModSite interactive SVG", () => {
  it("draws the markup in a frame that runs nothing and cannot reach the app", async () => {
    await using screen = await render(
      <Surface
        node={{
          type: "svg",
          source:
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><text y="4">Hello</text></svg>',
          alt: "Greeting",
          width: 120,
          interactive: true,
        }}
        visible
      />,
    );
    const frame = screen.getByTitle("Greeting");
    // expect.element cannot see into another origin; Playwright resolves the text there
    // itself. `force` skips its hit test, which the runner's own overlay fails.
    await page.frameLocator(frame).getByText("Hello").hover({ force: true });

    const element = frame.element();
    if (!(element instanceof HTMLIFrameElement)) throw new Error("expected a frame");
    // An opaque origin: the app cannot read the frame, nor the frame the app.
    expect(element.contentDocument).toBeNull();
    expect(element.sandbox.contains("allow-scripts")).toBe(false);
    // The side the mod left out follows the viewBox's proportions.
    const box = element.getBoundingClientRect();
    expect({ width: box.width, height: box.height }).toEqual({ width: 120, height: 60 });
  });

  it("shows the alt text for markup that is not well-formed SVG", async () => {
    await using screen = await render(
      <Surface
        node={{ type: "svg", source: "<svg><g></svg>", alt: "Broken chart", interactive: true }}
        visible
      />,
    );
    await expect.element(screen.getByText("Broken chart")).toBeVisible();
    expect(screen.container.querySelector("iframe")).toBeNull();
  });
});
