import { contextBridge } from "electron";

// Extensions written against the WebExtensions `browser` namespace must reach the
// `chrome` object ECE's preload patched.
// executeInMainWorld serializes this function, so it must not close over module bindings.
const aliasBrowserToChrome = () => {
  Object.defineProperty(globalThis, "browser", {
    value: Reflect.get(globalThis, "chrome"),
    configurable: true,
    writable: true,
  });
};

if (process.type === "service-worker" || location.href.startsWith("chrome-extension://")) {
  // ECE's tabs.update can load an extension page into a guest without context isolation.
  if (process.contextIsolated) {
    contextBridge.executeInMainWorld({ func: aliasBrowserToChrome });
  } else {
    aliasBrowserToChrome();
  }
}
