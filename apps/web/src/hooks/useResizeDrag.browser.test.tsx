import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { useResizeDrag } from "./useResizeDrag";

function DragHandle(props: { readonly onFinish: (size: number, moved: boolean) => void }) {
  const { ref, onPointerDown, onPointerUp } = useResizeDrag<HTMLDivElement>(() => ({
    width: 100,
    axis: "y",
    edge: "bottom",
    bounds: { min: 0, max: 1000 },
    resize: (size) => size,
    finish: props.onFinish,
  }));
  return (
    <div
      aria-label="Drag handle"
      className="h-4 w-4"
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    />
  );
}

function pointer(type: string, clientX: number, clientY: number) {
  const target = document.querySelector('[aria-label="Drag handle"]');
  if (!target) throw new Error("No drag handle");
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1, clientX, clientY }),
  );
}

describe("useResizeDrag", () => {
  it("useResizeDrag should report vertical deltas when axis is y", async () => {
    const onFinish = vi.fn();
    await using _screen = await render(<DragHandle onFinish={onFinish} />, {
      router: false, // A bare hook harness, nothing reads the route.
    });
    // Synthetic pointer ids are not active pointers, so the browser would reject capture.
    using _capture = vi
      .spyOn(HTMLElement.prototype, "setPointerCapture")
      .mockImplementation(() => {});

    await act(async () => {
      pointer("pointerdown", 10, 10);
      pointer("pointerup", 15, 50);
    });

    expect(onFinish).toHaveBeenCalledWith(140, true);
  });
});
