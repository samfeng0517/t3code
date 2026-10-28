# Agent browser tools

Agents in T3 Code can use the thread's browser: open a tab, go to a website or a
dev server on the environment, read the page, take screenshots, click, type,
press keys, scroll, run JavaScript, resize the viewport, switch light and dark
mode, and record what they did. Ask in plain words ("open the dev server and
check the signup form"), and the tab appears in the thread's browser panel so
you can watch. An agent can also open a tab under one of your
[browser profiles](browser-import.md) to use its saved logins.

This works with every provider, on web, desktop, and mobile. In the desktop app,
agents use its browser tabs; elsewhere, and on remote environments, they use the
environment's own browser, which you watch as a stream. See
[Browser on a remote environment](remote-access.md#browser-on-a-remote-environment).

Hovering, dragging, choosing from native dropdowns, uploading files, right-clicking, and
answering page dialogs work only in the environment's own browser, not in the desktop
app's tabs.

## You and the agent share tabs

An agent reads any tab in the thread, including ones you opened, but acts only
on its own tabs, or on yours while nobody is controlling it. Take control of a
tab to type into it yourself; the agent waits until you release it.

To point at something on a page in the desktop app's own tabs, use **Annotate
preview** in the browser panel to mark elements, regions, or drawings and add
them to your message.

## Turn it off

**Settings → Browser → Agent browser access** controls whether agents get
the browser tools. It is on by default. A project can override it from the
project crumb in the same settings page. A change applies when an agent session
next starts.

Agents cannot control the rest of your computer, such as other apps or the
mouse and keyboard outside T3 Code.
