import { describe, expect, it } from "vite-plus/test";

import {
  htmlRenderCommentAnchorRequest,
  htmlRenderCommentAnchorsRequest,
  htmlRenderCommentScrollRequest,
  injectHtmlFileCommentBootstrap,
  injectHtmlRenderBootstrap,
  readHtmlRenderCommentAnchor,
  readHtmlRenderCommentAnchors,
  readHtmlRenderCommentView,
  readHtmlRenderImageRequest,
  readHtmlRenderLinkRequest,
} from "./htmlRender.ts";
import { htmlRenderFromToolItem } from "./toolOutput.ts";

const reference = { attachmentId: "thread-abc-123.html", title: "Chart", height: 420 };

describe("injectHtmlRenderBootstrap", () => {
  it("puts the theme ahead of the page's own head content", () => {
    const html =
      "<!doctype html><html><head><style>:root{--background:red}</style></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    const themeAt = injected.indexOf('<style id="t3-theme">');
    expect(themeAt).toBeGreaterThan(injected.indexOf("<head>"));
    expect(themeAt).toBeLessThan(injected.indexOf(":root{--background:red}"));
    expect(injected).toContain('<meta charset="utf-8">');
    expect(injected).toContain('name="viewport"');
  });

  it("wraps fragments without a head and keeps existing meta tags", () => {
    const fragment =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>hi</p>';
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.match(/charset/g)).toHaveLength(1);
    expect(injected.match(/name="viewport"/g)).toHaveLength(1);
    expect(injected.endsWith("<p>hi</p>")).toBe(true);
  });

  it.each(["textarea", "iframe", "plaintext"])("keeps the bootstrap outside %s content", (tag) => {
    const fragment = `<${tag}><head><meta name="viewport"></head></${tag}>`;
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf(`<${tag}>`));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it.each([
    '<template><head><meta name="viewport"></head></template>',
    '<template><template>inner</template><head><meta name="viewport"></head></template>',
  ])("keeps the bootstrap outside inert template content: %s", (fragment) => {
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf("<template>"));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it("ignores tags written inside comments and scripts", () => {
    const html =
      '<!-- copy <head> and <meta name="viewport"> here --><html><head>' +
      "<script>const tag = '<meta name=\"viewport\">';</script></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    expect(injected.indexOf('<style id="t3-theme">')).toBeGreaterThan(
      injected.indexOf("<html><head>"),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
  });
});

describe("readHtmlRenderLinkRequest", () => {
  it("accepts only http(s) URLs in an MCP Apps ui/open-link request", () => {
    const link = (url: unknown, modifiers = {}) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/open-link",
      params: { url, ...modifiers },
    });
    expect(readHtmlRenderLinkRequest(link("https://example.com/a"))).toEqual({
      id: 1,
      url: "https://example.com/a",
      metaKey: false,
      ctrlKey: false,
    });
    expect(
      readHtmlRenderLinkRequest(link("https://example.com/a", { metaKey: true, ctrlKey: "yes" })),
    ).toEqual({ id: 1, url: "https://example.com/a", metaKey: true, ctrlKey: false });
    expect(readHtmlRenderLinkRequest(link("javascript:alert(1)"))).toBeUndefined();
    expect(readHtmlRenderLinkRequest(link("file:///etc/passwd"))).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({
        jsonrpc: "2.0",
        method: "ui/open-link",
        params: { url: "https://example.com" },
      }),
    ).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({ type: "t3-html-render-link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});

describe("readHtmlRenderImageRequest", () => {
  it("accepts http(s) and inline image URLs in an open-image notification", () => {
    const image = (params: unknown) => ({
      jsonrpc: "2.0",
      method: "t3/notifications/open-image",
      params,
    });
    expect(
      readHtmlRenderImageRequest(image({ src: "data:image/png;base64,AA", name: " Chart " })),
    ).toEqual({
      src: "data:image/png;base64,AA",
      name: "Chart",
    });
    expect(readHtmlRenderImageRequest(image({ src: "https://example.com/a.png" }))).toEqual({
      src: "https://example.com/a.png",
      name: "Image",
    });
    expect(readHtmlRenderImageRequest(image({ src: "javascript:alert(1)" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "data:text/html,<p>" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "blob:null/1" }))).toBeUndefined();
  });
});

describe("htmlRenderFromToolItem", () => {
  const result = { htmlRender: reference, message: "Rendered above your reply." };

  it("reads the reference from each provider's result envelope", () => {
    for (const [toolName, output] of [
      ["mcp__t3-code__html_render", [{ type: "text", text: JSON.stringify(result) }]],
      ["t3-code.html_render", { structuredContent: result, content: [] }],
      ["t3-code-thread_1_html_render", JSON.stringify(result)],
      ["html_render", result],
    ] as const) {
      expect(htmlRenderFromToolItem({ toolName, output })).toEqual(reference);
    }
  });
});

describe("comment anchors", () => {
  interface FakeElement {
    nodeType: 1;
    tagName: string;
    localName: string;
    id: string;
    parentElement: FakeElement | null;
    children: FakeElement[];
    innerText: string;
    getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
  }
  // HTML upper-cases tagName; an SVG element keeps its case in both names.
  const element = (
    tagName: string,
    parent: FakeElement | null,
    id = "",
    text = "",
    svg = false,
  ): FakeElement => {
    const node: FakeElement = {
      nodeType: 1,
      tagName: svg ? tagName : tagName.toUpperCase(),
      localName: svg ? tagName : tagName.toLowerCase(),
      id,
      parentElement: parent,
      children: [],
      innerText: text,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 100, height: 30 }),
    };
    parent?.children.push(node);
    return node;
  };

  const runAnchorScript = (
    hit: (x: number, y: number) => FakeElement | null,
    find: (selector: string) => FakeElement | null = () => null,
  ) => {
    const injected = injectHtmlRenderBootstrap("<p>x</p>");
    const scripts = [...injected.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    const script = scripts.find((source) => source.includes("comment-anchor"));
    const html = element("html", null);
    const body = element("body", html);
    const listeners: Array<(event: unknown) => void> = [];
    const watched: string[] = [];
    const posted: unknown[] = [];
    const parent = { postMessage: (message: unknown) => posted.push(message) };
    const scrolled: Array<[number, number]> = [];
    const fakeWindow = {
      parent,
      scrollX: 0,
      scrollY: 200,
      scrollBy: (x: number, y: number) => scrolled.push([x, y]),
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        if (type === "message") listeners.push(listener);
        else watched.push(type);
      },
    };
    const fakeDocument = {
      documentElement: Object.assign(html, { scrollWidth: 800, scrollHeight: 1600 }),
      body,
      elementFromPoint: hit,
      querySelector: (selector: string) => {
        if (selector === "!") throw new Error("invalid selector");
        return find(selector);
      },
    };
    new Function("window", "document", script!)(fakeWindow, fakeDocument);
    const send = (source: unknown, data: unknown) => {
      for (const listener of listeners) listener({ source, data });
    };
    const ask = (source: unknown, rect = { x: 15, y: 25, width: 0, height: 0 }) =>
      send(source, htmlRenderCommentAnchorRequest("r1", rect));
    return { html, body, ask, send, parent, posted, watched, scrolled };
  };

  it("answers the parent with the element's path, text, and page box", () => {
    const page = runAnchorScript(() => heading);
    const main = element("main", page.body);
    element("h2", main);
    const heading = element("h2", main, "", "  Revenue \n by quarter ");
    page.ask(page.parent);
    const anchor = readHtmlRenderCommentAnchor(page.posted[0]);
    expect(anchor).toEqual({
      requestId: "r1",
      page: { width: 800, height: 1600 },
      scroll: { x: 0, y: 200 },
      element: {
        selector: "body > main > h2:nth-of-type(2)",
        tagName: "h2",
        text: "Revenue by quarter",
        rect: { x: 10, y: 220, width: 100, height: 30 },
      },
    });
  });

  it("stops the path at an id and ignores other senders", () => {
    const page = runAnchorScript(() => cell);
    const section = element("section", page.body, "pricing");
    const cell = element("td", element("tr", element("table", section)));
    page.ask({});
    expect(page.posted).toEqual([]);
    page.ask(page.parent);
    expect(readHtmlRenderCommentAnchor(page.posted[0])?.element?.selector).toBe(
      "section#pricing > table > tr > td",
    );
  });

  it("roots the path at body so nested same-tag siblings cannot match first", () => {
    const page = runAnchorScript(() => last);
    const wrapper = element("div", page.body);
    element("p", wrapper, "", "a");
    element("p", wrapper, "", "b");
    element("p", page.body, "", "c");
    const last = element("p", page.body, "", "d");
    page.ask(page.parent);
    expect(readHtmlRenderCommentAnchor(page.posted[0])?.element).toMatchObject({
      selector: "body > p:nth-of-type(2)",
      text: "d",
    });
  });

  it("keeps the case of SVG names so the path still matches", () => {
    const page = runAnchorScript(() => stop);
    const svg = element("svg", page.body, "", "", true);
    const defs = element("defs", svg, "", "", true);
    const gradient = element("linearGradient", defs, "", "", true);
    const stop = element("stop", gradient, "", "", true);
    page.ask(page.parent);
    expect(readHtmlRenderCommentAnchor(page.posted[0])?.element?.selector).toBe(
      "body > svg > defs > linearGradient > stop",
    );
  });

  it("names no path rather than a cut one for a very deep element", () => {
    let node = element("section", null);
    const page = runAnchorScript(() => node);
    node = element("section", page.body);
    for (let depth = 0; depth < 80; depth += 1) node = element("section", node);
    page.ask(page.parent);
    const answer = readHtmlRenderCommentAnchor(page.posted[0]);
    expect(answer?.element?.selector).toBe("");
    expect(answer?.element?.tagName).toBe("section");
  });

  it("re-finds saved selectors and then watches the page's scroll", () => {
    const page = runAnchorScript(
      () => null,
      (selector) => (selector === "main > h2" ? heading : null),
    );
    const heading = element("h2", element("main", page.body), "", " Revenue ");
    page.send({}, htmlRenderCommentAnchorsRequest("r2", ["main > h2"]));
    expect(page.posted).toEqual([]);
    page.send(page.parent, htmlRenderCommentAnchorsRequest("r2", ["main > h2", "p.gone", "!"]));
    expect(readHtmlRenderCommentAnchors(page.posted[0])).toEqual({
      requestId: "r2",
      page: { width: 800, height: 1600 },
      scroll: { x: 0, y: 200 },
      anchors: [{ text: "Revenue", rect: { x: 10, y: 220, width: 100, height: 30 } }, null, null],
    });
    expect(page.watched).toEqual(["scroll"]);
  });

  it("scrolls for the parent's comment layer only", () => {
    const page = runAnchorScript(() => null);
    page.send({}, htmlRenderCommentScrollRequest(0, 40));
    page.send(page.parent, htmlRenderCommentScrollRequest(0, 40));
    expect(page.scrolled).toEqual([[0, 40]]);
    expect(page.posted).toEqual([]);
  });

  it("reads scroll reports and rejects a malformed one", () => {
    const view = (params: unknown) =>
      readHtmlRenderCommentView({
        jsonrpc: "2.0",
        method: "t3/notifications/comment-view",
        params,
      });
    expect(view({ page: { width: 10, height: 20 }, scroll: { x: 0, y: 5 } })).toEqual({
      page: { width: 10, height: 20 },
      scroll: { x: 0, y: 5 },
    });
    expect(view({ page: { width: 10, height: 20 }, scroll: { x: "0", y: 5 } })).toBeUndefined();
  });

  it("reports the bare page without an element", () => {
    const page = runAnchorScript(() => page.body);
    page.ask(page.parent);
    expect(readHtmlRenderCommentAnchor(page.posted[0])?.element).toBeUndefined();
  });

  it("rejects malformed answers", () => {
    const answer = (params: unknown) =>
      readHtmlRenderCommentAnchor({
        jsonrpc: "2.0",
        method: "t3/notifications/comment-anchor",
        params,
      });
    expect(
      answer({ requestId: "r1", page: { width: 0, height: 10 }, scroll: { x: 0, y: 0 } }),
    ).toBe(undefined);
    expect(answer({ requestId: 1, page: { width: 10, height: 10 }, scroll: { x: 0, y: 0 } })).toBe(
      undefined,
    );
    expect(
      answer({
        requestId: "r1",
        page: { width: 10, height: 10 },
        scroll: { x: 0, y: 0 },
        selector: "p",
        tagName: "P",
        rect: { x: Number.NaN, y: 0, width: 1, height: 1 },
      })?.element,
    ).toBeUndefined();
  });
});

describe("injectHtmlFileCommentBootstrap", () => {
  it("adds only the anchor script, without the visual-reply theme", () => {
    const html = injectHtmlFileCommentBootstrap(
      "<!doctype html><html><head><title>A</title></head><body>x</body></html>",
    );
    expect(html.startsWith("<!doctype html><html><head><script>")).toBe(true);
    expect(html).toContain("comment-anchor");
    expect(html).not.toContain("t3-theme");
    expect(html).not.toContain("<base");
  });

  it("keeps a file without a doctype in quirks mode", () => {
    const html = injectHtmlFileCommentBootstrap("<p>x</p>");
    expect(html.startsWith("<head><script>")).toBe(true);
    expect(html.endsWith("</script></head><p>x</p>")).toBe(true);
    expect(injectHtmlRenderBootstrap("<p>x</p>").startsWith("<!doctype html><head>")).toBe(true);
  });
});
