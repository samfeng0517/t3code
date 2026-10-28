# T3 Code MCP tool catalog

Source of truth: `apps/server/src/mcp/toolkits/*/tools.ts` (definitions) and
the matching `handlers.ts` (access wrapper). Regenerate this page when a tool
is added there; the counts below are from that source.

**Access** column, derived from the `McpToolAccess` wrapper each handler uses:

| Access       | Wrapper                                                            | Who can call it                                                                                     |
| ------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| any          | `reads`                                                            | Any approved client, including Read only, and any agent inside a thread.                            |
| write        | `writes`, `writesThreads`, `startsThreads`, `writesWithCapability` | Supervised or Full access clients; inside a thread, any live caller. Refused for Read only clients. |
| full         | `writesEnvironment`                                                | Full access clients, or a calling thread in full-access/default modes.                              |
| thread read  | `readsAsCaller`                                                    | Only an agent running inside a T3 thread.                                                           |
| thread write | `actsAsCaller`                                                     | Only an agent running inside a T3 thread, and not from a Read only client.                          |

A write to another thread also fails with `*_mode_escalation_denied` when that
thread runs with broader permission modes than the caller.

## Environment and projects

| Tool                                | Access | What it does                                                                                            |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| `t3_environment_read`               | any    | Server identity, version, platform and selected preferences.                                            |
| `t3_environment_preferences_update` | full   | Update environment-wide preferences; omitted fields are kept.                                           |
| `t3_project_list`                   | any    | Registered projects, paged.                                                                             |
| `t3_project_read`                   | any    | One project with its workspace and saved scripts.                                                       |
| `t3_project_create`                 | full   | Register a directory, or create a fresh Git repository from a title when `workspaceRoot` is omitted.    |
| `t3_project_update`                 | full   | Change project settings; omitted fields are kept.                                                       |
| `t3_project_delete`                 | full   | Delete a project record; `force=true` also deletes all of the project's threads. The directory stays.   |
| `t3_project_clone`                  | full   | Clone a repository; register the returned `cwd` with `t3_project_create` afterwards.                    |
| `orchestrator_capabilities`         | any    | Provider instances, models (use `search` for omitted ones), inherited modes and orchestration features. |

## Threads

| Tool                      | Access | What it does                                                                                                                                  |
| ------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `t3_thread_list`          | any    | Threads in a project, newest first; filter by run status, title, settled or snoozed state; paged by cursor.                                   |
| `t3_thread_search`        | any    | Bounded search of active thread titles and content in `projectId` (the caller's project by default; every project when omitted from outside). |
| `t3_thread_read`          | any    | Durable state plus a paged timeline (`messages` or `activity` view); long items continue with `textOffset`.                                   |
| `t3_thread_wait`          | any    | Block until the latest (or given) run reaches a terminal state or the timeout; a timeout does not stop the work.                              |
| `t3_thread_configuration` | any    | A thread's provider, model and modes.                                                                                                         |
| `t3_thread_transfers`     | any    | Context transfer status for a thread.                                                                                                         |
| `t3_thread_launch`        | write  | Create a top-level thread with an explicit workspace binding (root, new worktree, existing worktree, or scratch) and a first message.         |
| `t3_thread_send`          | write  | Message any thread: `auto`, `queue`, `steer` or `restart`; `clientRequestId` makes retries idempotent.                                        |
| `t3_thread_interrupt`     | write  | Interrupt the newest interruptible run.                                                                                                       |
| `t3_thread_update`        | write  | Rename, regenerate the title, link or unlink a pull request.                                                                                  |
| `t3_thread_organize`      | write  | Pin, snooze, settle, archive, mark unread, and each reverse action.                                                                           |
| `t3_thread_configure`     | write  | Set provider, model and options; permission modes are not changed.                                                                            |
| `t3_thread_fork`          | write  | Fork from a stable run or checkpoint; the fork inherits the source configuration.                                                             |
| `t3_thread_merge_back`    | write  | Merge context from a thread back into a related thread of the same project.                                                                   |
| `t3_workflow_stop`        | write  | Stop one running Claude workflow by its coordinator `subagentId` (from the `activity` view).                                                  |

## Queue and pending questions

| Tool                         | Access | What it does                                                             |
| ---------------------------- | ------ | ------------------------------------------------------------------------ |
| `t3_queue_list`              | any    | Queued messages in delivery order.                                       |
| `t3_queue_read`              | any    | Up to 16,000 characters of one queued message.                           |
| `t3_queue_edit`              | write  | Replace a queued message's text, keeping attachments.                    |
| `t3_queue_reorder`           | write  | Move a queued run before another, or to the end with `beforeRunId=null`. |
| `t3_queue_cancel`            | write  | Cancel a queued run.                                                     |
| `t3_queue_promote_to_steer`  | write  | Deliver a queued message as steering to an active run.                   |
| `t3_pending_request_list`    | any    | Pending user questions in a thread; approval requests are not included.  |
| `t3_pending_request_read`    | any    | One pending question.                                                    |
| `t3_pending_request_respond` | write  | Answer a pending question. Cannot approve a permission request.          |

## Attachments

| Tool                           | Access | What it does                                                                                                   |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------- |
| `t3_attachment_prepare_upload` | write  | Signed upload URL; POST the bytes to `relativeUrl` on the MCP server's origin, then send with the returned id. |
| `t3_attachment_discard`        | write  | Discard a pending upload; delivered attachments are untouched.                                                 |
| `t3_thread_send_attachments`   | write  | Send uploaded attachments as a new message to any thread.                                                      |

## Delegation and scheduling

| Tool                     | Access       | What it does                                                                                          |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------------- |
| `delegate_task`          | thread write | Run one task in a T3-owned child agent of this thread, with only the supplied prompt.                 |
| `task_status`            | thread write | Status and final summary of a delegated task (`working`, `waiting_for_children`, `result_available`). |
| `task_cancel`            | thread write | Stop a delegated task and its child thread, including later child runs.                               |
| `create_threads`         | thread write | Create ordinary top-level threads in a batch; not delegation.                                         |
| `request_secret`         | thread write | Ask the user for a secret through a private card; you get a `secretRef`, never the value.             |
| `schedule_task`          | write        | Persistent scheduled work: interval, fixed time or webhook; pass `schedule` as a structured object.   |
| `list_scheduled_tasks`   | any          | Scheduled tasks in a project (every project when called outside a thread without `projectId`).        |
| `update_scheduled_task`  | write        | Change fields of a scheduled task; `enabled=false` pauses it.                                         |
| `delete_scheduled_task`  | write        | Delete a scheduled task; it stops immediately.                                                        |
| `run_scheduled_task_now` | full         | Dispatch a manual run; returns the thread it ran in.                                                  |

## Pull requests

| Tool                        | Access | What it does                                                                                  |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `list_thread_pull_requests` | any    | Pull requests linked to a thread with their last known state and stack order.                 |
| `read_pull_request_guide`   | any    | A stored review guide and its run state; never starts a run.                                  |
| `link_pull_request`         | write  | Link a pull request to this thread so T3 tracks it and settles the thread on merge.           |
| `unlink_pull_request`       | write  | Remove a link.                                                                                |
| `watch_pull_request`        | write  | Have T3 wake this thread on failed or passed checks, new comments or reviews, and conflicts.  |
| `unwatch_pull_request`      | write  | Stop watching; the link stays.                                                                |
| `write_pull_request_guides` | write  | Start review-guide runs for up to 20 pull requests; fails while guides are off on the server. |

## Worktrees

| Tool                  | Access       | What it does                                                                                |
| --------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `t3_worktree_list`    | any          | Branch refs and checkout paths for a thread's workspace.                                    |
| `t3_worktree_status`  | thread read  | This thread's worktree binding; call before `t3_worktree_handoff`.                          |
| `t3_worktree_handoff` | thread write | Move this thread into a new worktree; the current turn ends shortly after, so call it last. |

## Browser preview

All preview tools act on the thread's collaborative browser tabs; `tabId`
selects a tab, omitted means this agent session's current tab. You can read any
tab; you act only on your own tabs or on an unclaimed one no human controls.

| Tool                      | Access       | What it does                                                                           |
| ------------------------- | ------------ | -------------------------------------------------------------------------------------- |
| `preview_status`          | thread read  | Tab list, control owner, pending dialog, URL, viewport, and accepted browser profiles. |
| `preview_snapshot`        | thread read  | Page state, semantic elements and accessibility refs; optional PNG.                    |
| `preview_wait_for`        | thread read  | Wait until locator, selector, text and URL conditions all match.                       |
| `preview_open`            | thread write | Open or reuse a tab, optionally under a browser profile.                               |
| `preview_navigate`        | thread write | Go to a URL or an environment port.                                                    |
| `preview_click`           | thread write | Click one target; `button=right`, `clickCount=2` on server tabs.                       |
| `preview_type`            | thread write | Insert text into one input; `clear=true` replaces.                                     |
| `preview_press`           | thread write | Press one key with optional modifiers.                                                 |
| `preview_scroll`          | thread write | Scroll the page or a container.                                                        |
| `preview_hover`           | thread write | Hover one target (server tabs only).                                                   |
| `preview_select`          | thread write | Choose options in a native `<select>` (server tabs only).                              |
| `preview_drag`            | thread write | Drag one element onto another (server tabs only).                                      |
| `preview_upload`          | thread write | Answer a file chooser or set an `<input type=file>` (server tabs only).                |
| `preview_dialog`          | thread write | Accept or dismiss a page dialog (server tabs only).                                    |
| `preview_evaluate`        | thread write | Run JavaScript in the tab; result up to 64 KB.                                         |
| `preview_resize`          | thread write | Fill, freeform size, or a device preset.                                               |
| `preview_set_appearance`  | thread write | Emulate `prefers-color-scheme`.                                                        |
| `preview_recording_start` | thread write | Start recording the tab.                                                               |
| `preview_recording_stop`  | thread write | Stop and transfer the recording to an evidence file on the environment.                |
| `t3_preview_list`         | thread read  | This thread's preview tabs.                                                            |
| `t3_preview_close`        | thread write | Close one tab owned by this thread.                                                    |

## Devices and HTML

| Tool                | Access       | What it does                                                                                         |
| ------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `device_list`       | thread read  | Simulators and emulators on the environment's device hosts, and which are open in this thread.       |
| `device_open`       | thread write | Boot and stream a device into the Device panel; returns the agent-device CLI invocation to drive it. |
| `device_screenshot` | thread read  | PNG of an open device's screen.                                                                      |
| `device_close`      | thread write | Remove a device from the panel; `shutdown=true` powers it off.                                       |
| `html_preview`      | thread read  | Render HTML headlessly and get a PNG, content height and console output.                             |
| `html_render`       | thread write | Render HTML into the thread as a reply-column page.                                                  |

Totals: 83 tools — 18 any, 25 write, 6 full, 8 thread read, 26 thread write.
