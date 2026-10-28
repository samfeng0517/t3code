# Browser sessions, bookmarks, and extensions

## Import sessions from another browser

The desktop app can import cookies from another browser so you can reuse its signed-in sessions
in the preview browser.

Open **Settings → Browser → Browser profiles → Add profile**, then choose a browser under
**Import from**. Close the source browser before importing, and allow an operating-system keyring
unlock prompt if one appears.

This is a one-time copy. Later login changes stay separate between the two browsers, and some
sites may still require you to sign in again.

On macOS, Safari imports need Full Disk Access. Choose **Allow**, drag T3 Code into the
System Settings permission list, and turn access on. **Continue** becomes available when access
is detected. macOS may require you to quit and reopen T3 Code before the grant applies; reopen
the import wizard afterward. You can revoke Full Disk Access once the import is done.

Chrome, Edge, Brave, Vivaldi, and Opera import on macOS and Linux, where you pick which of the
browser's profiles to copy. Arc imports on macOS only.

On Windows, import supports Firefox, Zen, and Helium profiles that use standard profile encryption.
Chrome and other Chromium-based browsers use app-bound encryption there and cannot be imported.
Partitioned cookies are skipped on all platforms.

## Bookmarks and the new tab page

A new browser tab shows a search box, your bookmarks bar, your most visited sites, and recently
visited pages from every thread and the browser workspace. Type an address to open it; anything
else searches with the engine chosen under **Settings → Browser → Search engine**.

Click the star in the address bar to bookmark the current page, and click it again to remove the
bookmark. **All bookmarks** on the new tab page lists every folder, where you can delete
bookmarks. To drop a site from most visited, hover it and click **×**; its history stays,
and **Restore removed** brings removed sites back.

To import bookmarks, click **Import bookmarks** on the new tab page or in
**Settings → Browser → Bookmarks**. The desktop app reads them straight from a
Chromium-based browser such as Chrome, Edge, Brave, or Arc, and you pick the profile; the browser
can stay open. On Windows this works for Chrome, Edge, Brave, and Helium, although Chrome, Edge,
and Brave cookies still cannot be imported there. Any client can instead import the HTML file from Chrome's
Bookmark manager (**⋮ → Export bookmarks**). Imported bookmarks go into their own folder that
keeps the source's folders. Importing the same browser profile again replaces that profile's
folder, and uploading a bookmarks file again replaces the folder from the previous file.

Bookmarks are saved only on the device that imported them.

## Chrome extensions

The desktop app can load Chrome extensions into the preview browser. Open
**Settings → Browser → Extensions**, click **Add from browser**, pick a Chrome, Edge, Brave,
Vivaldi or Opera profile, and check the extensions to copy. An extension can be copied from only
one profile. A copied extension follows that
browser: when the browser updates it, the app swaps in the new version within ten minutes, or at
once when you click the puzzle button in the sidebar's **Browser** heading. Open tabs keep the old
version until you reload them. If the browser no longer has the extension, the copy keeps working
and its row says so.

To load an extension no browser has installed, click **Add unpacked** and choose the folder that
contains its `manifest.json`. Reload open tabs to apply a change. Use the switch to turn an
extension off without removing it.

Extensions load into every browser profile except incognito, and apply only to the desktop app's
own browser tabs, not to a remote environment's streamed browser. They cannot be installed from the
Chrome Web Store directly: install them in your browser and add them from there.
Content scripts and background pages or service workers run. Each extension's button appears to
the right of the address bar and opens its popup. Pages an extension opens, such as a welcome page,
open in their own window, which closes with the main window. Extension items appear at the end of
a page's right-click menu. Options pages cannot be opened from the toolbar, and some Chrome APIs,
such as side panels, are not available, so extensions that need them do not work. To connect the
1Password extension to the 1Password desktop app, add this app under **Settings → Browser** in the
1Password app. If an extension fails to load or update, its row in settings shows why.
