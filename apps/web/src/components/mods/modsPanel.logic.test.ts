import { EMPTY_MOD_SURFACE_VIEW } from "@t3tools/client-runtime/state/mods";
import { describe, expect, it } from "vite-plus/test";

import {
  clearAfterSubmit,
  createModActionQueue,
  hasModAutoFocus,
  hasModsBand,
  isOpenableModLink,
  isTextEntryElement,
  modInputDraft,
  modsPanelBody,
  modSvgFrameDocument,
  modSvgFrameSize,
  modSvgImageSource,
  reconcileModInput,
  typeIntoModInput,
  unseenModToasts,
} from "./modsPanel.logic";

const toast = (id: string) => ({ id, plugin: "demo", text: id, timeoutMs: 4000 });

describe("modsPanelBody", () => {
  it("asks for a server update before anything else", () => {
    expect(modsPanelBody(false, EMPTY_MOD_SURFACE_VIEW).kind).toBe("server-unsupported");
  });

  it("tells a stopped session from an agent without mods", () => {
    expect(modsPanelBody(true, null).kind).toBe("loading");
    expect(modsPanelBody(true, EMPTY_MOD_SURFACE_VIEW).kind).toBe("inactive");
    expect(
      modsPanelBody(true, { ...EMPTY_MOD_SURFACE_VIEW, availability: "unsupported" }).kind,
    ).toBe("unsupported");
    expect(modsPanelBody(true, { ...EMPTY_MOD_SURFACE_VIEW, availability: "available" }).kind).toBe(
      "empty",
    );
  });

  it("shows the panes once a mod opens one", () => {
    expect(
      modsPanelBody(true, {
        ...EMPTY_MOD_SURFACE_VIEW,
        availability: "available",
        panes: [{ id: "p", title: "P", plugin: "demo", tree: null }],
      }).kind,
    ).toBe("panes");
  });
});

describe("hasModsBand", () => {
  it("shows the band only for a drawing or a status line", () => {
    expect(hasModsBand(null)).toBe(false);
    expect(hasModsBand(EMPTY_MOD_SURFACE_VIEW)).toBe(false);
    expect(hasModsBand({ ...EMPTY_MOD_SURFACE_VIEW, statuses: [{ plugin: "d", text: "x" }] })).toBe(
      true,
    );
  });
});

describe("unseenModToasts", () => {
  it("raises each toast once, in order", () => {
    const toasts = [toast("a"), toast("b"), toast("c")];
    expect(unseenModToasts(toasts, null).map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(unseenModToasts(toasts, "b").map((entry) => entry.id)).toEqual(["c"]);
    expect(unseenModToasts(toasts, "c")).toEqual([]);
  });

  it("raises every kept toast when the last one raised was dropped", () => {
    expect(unseenModToasts([toast("x"), toast("y")], "gone").map((entry) => entry.id)).toEqual([
      "x",
      "y",
    ]);
  });
});

describe("isOpenableModLink", () => {
  it("opens web links and leaves anything else as text", () => {
    expect(isOpenableModLink("https://example.com")).toBe(true);
    expect(isOpenableModLink("http://localhost:3000")).toBe(true);
    expect(isOpenableModLink("javascript:alert(1)")).toBe(false);
    expect(isOpenableModLink("file:///etc/passwd")).toBe(false);
    expect(isOpenableModLink("not a url")).toBe(false);
  });
});

describe("createModActionQueue", () => {
  it("sends one edit at a time, collapsing edits typed meanwhile into the latest", async () => {
    const sent: Array<string> = [];
    const busy: Array<boolean> = [];
    const answers: Array<() => void> = [];
    const queue = createModActionQueue((value) => busy.push(value));
    const send = (text: string) => () => {
      sent.push(text);
      return new Promise<void>((resolve) => answers.push(resolve));
    };

    const first = queue.push(send("a"), { collapsible: true });
    const replaced = queue.push(send("ab"), { collapsible: true });
    const second = queue.push(send("abc"), { collapsible: true });
    await replaced;
    const submit = queue.push(send("submit abc"), { collapsible: false });
    const last = queue.push(send("abcd"), { collapsible: true });
    expect(sent).toEqual(["a"]);

    answers[0]?.();
    await first;
    expect(sent).toEqual(["a", "abc"]);
    answers[1]?.();
    await second;
    answers[2]?.();
    await submit;
    expect(sent).toEqual(["a", "abc", "submit abc", "abcd"]);
    expect(busy).toEqual([true]);
    answers[3]?.();
    await last;
    expect(busy).toEqual([true, false]);
  });

  it("keeps sending after a failed edit", async () => {
    const sent: Array<string> = [];
    const queue = createModActionQueue(() => {});
    void queue.push(() => Promise.reject(new Error("socket closed")), { collapsible: false });
    await queue.push(
      () => {
        sent.push("next");
        return Promise.resolve();
      },
      { collapsible: false },
    );
    expect(sent).toEqual(["next"]);
  });
});

describe("reconcileModInput", () => {
  it("keeps the person's typing when the mod echoes an older text late", () => {
    let draft = modInputDraft("");
    draft = typeIntoModInput(draft, "a");
    draft = typeIntoModInput(draft, "ab");
    draft = typeIntoModInput(draft, "abc");
    const echoed = reconcileModInput(draft, "a", false);
    expect(echoed.text).toBe("abc");
    const caughtUp = reconcileModInput(echoed, "abc", false);
    expect(caughtUp).toEqual(modInputDraft("abc"));
    expect(reconcileModInput(caughtUp, "abc", false)).toBe(caughtUp);
  });

  it("takes a value the mod set, once the edits it has not seen are sent", () => {
    const draft = typeIntoModInput(modInputDraft(""), "hello");
    expect(reconcileModInput(draft, "HELLO", true)).toBe(draft);
    expect(reconcileModInput(draft, "HELLO", false)).toEqual(modInputDraft("HELLO"));
  });

  it("a handled submit clears the field when nothing was typed since", () => {
    const draft = reconcileModInput(typeIntoModInput(modInputDraft(""), "hi"), "hi", false);
    expect(clearAfterSubmit(draft, "hi")).toEqual({ ...draft, text: "" });
  });

  it("a submit does not clear when the person typed meanwhile", () => {
    const draft = typeIntoModInput(typeIntoModInput(modInputDraft(""), "hi"), "hi!");
    expect(clearAfterSubmit(draft, "hi")).toBe(draft);
  });

  it("an unchanged drawing after a submit keeps the cleared field", () => {
    // The mod draws "hi" before and after the submit; an always-empty mod likewise keeps "".
    const kept = clearAfterSubmit(
      reconcileModInput(typeIntoModInput(modInputDraft(""), "hi"), "hi", false),
      "hi",
    );
    expect(reconcileModInput(kept, "hi", false).text).toBe("");
    const alwaysEmpty = clearAfterSubmit(typeIntoModInput(modInputDraft(""), "hi"), "hi");
    expect(reconcileModInput(alwaysEmpty, "", false).text).toBe("");
  });

  it("a different drawing after a submit is taken", () => {
    const cleared = clearAfterSubmit(
      reconcileModInput(typeIntoModInput(modInputDraft(""), "hi"), "hi", false),
      "hi",
    );
    expect(reconcileModInput(cleared, "saved: hi", false)).toEqual(modInputDraft("saved: hi"));
  });

  it("ignores a late echo of typing that went on after a submit", () => {
    let draft = reconcileModInput(typeIntoModInput(modInputDraft(""), "hi"), "hi", false);
    draft = typeIntoModInput(clearAfterSubmit(draft, "hi"), "x");
    draft = typeIntoModInput(draft, "xy");
    expect(reconcileModInput(draft, "x", false).text).toBe("xy");
  });
});

describe("modSvgImageSource", () => {
  it("encodes the markup whole into an image source", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><text>#1 & 50%</text></svg>';
    const url = modSvgImageSource(source) ?? "";
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(source);
    expect(url).not.toContain("#");
  });

  it("gives up on markup that cannot be encoded instead of throwing", () => {
    expect(modSvgImageSource("<svg><text>\uD800</text></svg>")).toBeNull();
  });
});

describe("modSvgFrameSize", () => {
  it("keeps both sides the mod gave", () => {
    expect(modSvgFrameSize({ width: 40, height: 90 }, { aspect: 2 })).toEqual({
      width: 40,
      height: 90,
    });
  });

  it("follows the markup's proportions for the side the mod left out", () => {
    expect(modSvgFrameSize({ width: 120 }, { width: 10, height: 10, aspect: 2 })).toEqual({
      width: 120,
      height: 60,
    });
    expect(modSvgFrameSize({ height: 30 }, { aspect: 2 })).toEqual({ width: 60, height: 30 });
  });

  it("takes the markup's own size when the mod gave none, else an image's default", () => {
    expect(modSvgFrameSize({}, { width: 64, aspect: 2 })).toEqual({ width: 64, height: 32 });
    expect(modSvgFrameSize({}, {})).toEqual({ width: 300, height: 150 });
  });

  it("never grows past Claude Code's bound", () => {
    expect(modSvgFrameSize({ width: 4096 }, { aspect: 0.001 }).height).toBe(4096);
  });
});

describe("modSvgFrameDocument", () => {
  it("puts the markup under a policy that fetches nothing and runs no script", () => {
    const document = modSvgFrameDocument("<svg/>");
    const policy = /http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(document)?.[1];
    expect(policy?.split("; ")).toContain("default-src 'none'");
    expect(policy).not.toContain("script-src");
    // The policy must be in the head, ahead of the markup, or it is not applied.
    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(document.indexOf("<svg/>"));
  });
});

describe("isTextEntryElement", () => {
  it("guards fields, editable regions and frames, not buttons", () => {
    const element = (tagName: string, isContentEditable = false) => ({
      tagName,
      isContentEditable,
    });
    expect(isTextEntryElement(element("TEXTAREA"))).toBe(true);
    expect(isTextEntryElement(element("INPUT"))).toBe(true);
    expect(isTextEntryElement(element("IFRAME"))).toBe(true);
    expect(isTextEntryElement(element("DIV", true))).toBe(true);
    expect(isTextEntryElement(element("BUTTON"))).toBe(false);
  });
});

describe("hasModAutoFocus", () => {
  it("finds a control marked autoFocus anywhere in the drawing", () => {
    const button = { type: "button", key: "b", label: "Go", plugin: "p", handle: 1 } as const;
    const nested = {
      type: "box",
      direction: "column",
      children: [{ type: "box", direction: "row", children: [{ ...button, autoFocus: true }] }],
    } as const;
    expect(hasModAutoFocus(nested)).toBe(true);
    expect(hasModAutoFocus({ type: "box", direction: "row", children: [button] })).toBe(false);
  });
});
