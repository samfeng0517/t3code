---
name: drive-t3
description: Drive a T3 Code environment from an agent - connect over its MCP server or the `t3 thread` CLI, then list projects, start and message threads, wait for results, answer agent questions, schedule work, watch pull requests, and reach the in-thread tools (delegation, browser preview, devices, worktree handoff). Use when an agent needs to operate T3 Code rather than change its source.
---

# Drive T3 Code

T3 Code exposes the same thread operations three ways. Pick one before doing
anything else:

| Situation                                                                                                           | Use                                                                           |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| You are an agent **running inside a T3 thread** (a user started you from the app)                                   | The MCP tools are already in your tool list. Skip to [Workflows](#workflows). |
| You run **on the host machine** and only need to start, message, and read threads                                   | [`t3 thread` CLI](#t3-thread-cli): no sign-in, no browser.                    |
| You run on **another machine**, or need anything beyond start/send/read (projects, queue, pending questions, forks) | [MCP over HTTP](#connect-over-mcp): one-time OAuth sign-in.                   |

Everything in this skill is also in the user guide,
[docs/user/outside-agents.md](../../../docs/user/outside-agents.md); the guide
is the source for user-facing wording, this skill for the agent's steps. The
full tool catalog with access requirements is in
[references/tools.md](references/tools.md).

## Connect over MCP

The MCP URL is the environment's address plus `/mcp`. The user copies it from
**Settings → Connections → (environment menu) → Copy MCP URL**; on the host,
`http://localhost:<port>/mcp` with the port from the running server also works.

```sh
# Claude Code
claude mcp add --transport http t3 https://<environment-address>/mcp
claude mcp login t3          # add --no-browser on a headless machine

# Codex
codex mcp add t3 --url https://<environment-address>/mcp
codex mcp login t3
```

Sign-in rules you cannot work around:

- Only `https` or `localhost` finishes OAuth. A plain-`http` LAN or Tailscale
  address (`http://100.x.y.z:3773`) reaches the server but the login fails.
  Ask the user for a T3 Connect or Tailscale HTTPS address instead.
- The login page asks for a **pairing code**. The user gets one from
  **Settings → Connections** or by running `t3 auth pairing create` on the
  host. A browser already signed in with manage-access rights can approve
  without a code. Never guess a code and never ask the user to paste a token
  into chat.
- The user then picks the client's access level. It caps everything below:

| Access level                           | What the tools let you do                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read only                              | Every tool marked `any` in [references/tools.md](references/tools.md). Every write fails with `capability_denied`.                                                             |
| Supervised, Auto-accept edits, or Auto | Also start, message, interrupt and organize threads, schedule work, and link or watch pull requests. A thread you start or steer is capped at the mode you were approved with. |
| Full access                            | Only this level also creates, updates, deletes and clones projects, changes environment preferences, and runs a scheduled task now.                                            |

A sign-in lasts 30 days. `claude mcp list` (or `codex mcp list`) shows `t3`
as connected once approved; the user revokes it under Settings → Connections.

### When a tool fails

| Error code / message                                                    | Meaning and what to do                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `capability_denied` … approved for read-only access                     | The client was approved Read only. Ask the user to revoke and re-approve with a higher level; do not retry.                           |
| `capability_denied` … needs a live full-access/default caller           | Project and environment writes need Full access (or, inside a thread, full-access/default modes).                                     |
| `target_required`                                                       | You are outside a thread and omitted `projectId` or `threadId`. Pass it explicitly (`t3_project_list`, `t3_thread_list`).             |
| `thread_credential_required`                                            | The tool acts as the calling thread, so it only works for an agent the app started. Use the thread-level equivalent or tell the user. |
| `runtime_mode_escalation_denied` / `interaction_mode_escalation_denied` | The target thread's modes are above yours. Pick another thread or ask the user to lower them.                                         |
| `parent_not_active`                                                     | Your own thread run ended; the server no longer treats you as a live caller.                                                          |

## `t3 thread` CLI

Available on the host that runs the environment; it talks to the running
server with no sign-in. Run `t3 thread --help` for the current flags.

```sh
id=$(t3 thread start . "Find why the tests are slow")   # prints the thread id
t3 thread send "$id" "Now fix it" --wait                 # prints the reply
t3 thread show "$id" --messages 5
t3 thread list --project .
```

- `.` means the project containing the current folder; a project id also
  works. `start` uses the project's default model and permission mode and runs
  in the project root unless you pass `--worktree <base-ref>` (optionally
  `--branch <name>`). `--provider <instance-id> --model <slug>` go together.
- `send` never interrupts: a busy thread gets the message as its next turn.
  Pass `-` as the message to read it from stdin.
- `--wait` exits `0` with the reply, `1` when the run failed or stopped, `2`
  when the agent is waiting for an answer the user gives in the app. Add
  `--json` for a result that always carries the thread id.
- Projects: `t3 project add <path> [--title]`, `t3 project rename`, and
  `t3 project remove`, whose `--force` also deletes every thread of the
  project.

The CLI has no equivalent for answering pending questions, forking, queue
edits, scheduling, pull requests, or anything under "Inside a T3 thread only"
below. Switch to MCP for those.

## Workflows

Tool names below are the MCP names; the CLI equivalent follows in
parentheses where one exists.

### Find where to work

1. `t3_environment_read` identifies the server you are talking to.
2. `t3_project_list` → pick a `projectId` (`t3 project` has no list command;
   use `.` or the workspace path).
3. `orchestrator_capabilities` lists provider instances and models you may
   choose from, plus the runtime and interaction modes you inherit.

### Start a thread and follow it

1. `t3_thread_launch` with `projectId`, `title` and `message` (`t3 thread start <project> <message>`; the CLI derives the title from the message's first line unless you pass `--title`). Omit `message` to create an idle thread.
   - For a new worktree: `workspaceStrategy: {type:"worktree", baseRef:"main", branch:"feature-x", startFromOrigin:false}` (`--worktree main --branch feature-x`).
   - For an existing checkout: `{type:"existing_worktree", worktreePath:"/abs/path", branch:"feature-x"}`.
   - Omitted `workspaceStrategy` means the project root, not your own worktree.
   - Outside a thread, `projectId` is required and the project's default model is used; pass `modelSelection` to override.
   - Keep the returned `threadId`. There is no retry key: after an error or a lost response, check `t3_thread_list` before launching again.
2. `t3_thread_wait` with that `threadId` (`t3 thread send … --wait`). It returns when the latest run reaches a terminal state (completed, failed, cancelled, interrupted, rolled back) or on timeout. A run blocked on a question is not terminal, so on `timedOut=true` call `t3_thread_read` with `limit:1` and check `thread.pendingRequestCount`: above 0 means the agent is waiting for an answer (see [Answer a question](#answer-a-question-the-agent-asked)); otherwise the work is still running and you call `t3_thread_wait` again.
3. `t3_thread_read` (`t3 thread show`) for the result. The default `messages` view gives user and assistant messages and proposed plans; `view:"activity"` gives every timeline item, including subagent ids. Page with `afterPosition=nextPosition`; long items continue with `itemId` + `textOffset=nextTextOffset`.
4. Mention a thread to the user as `[title](t3-thread://v1/<threadId>)` with the id exactly as returned.

### Send a follow-up

`t3_thread_send` with `threadId`, `message` and an optional `mode` (`t3 thread send`):

| `mode`    | Effect                                                                            |
| --------- | --------------------------------------------------------------------------------- |
| `auto`    | Starts an idle thread, steers a steerable running turn, else queues. The default. |
| `queue`   | A separate follow-up turn after the current one.                                  |
| `steer`   | Joins the in-flight turn with new instructions.                                   |
| `restart` | Interrupts the active turn and restarts with this message.                        |

Pass a fresh `clientRequestId` per intended message; repeating one makes the
retry idempotent. Attachments: `t3_attachment_prepare_upload` → POST the bytes
to the returned `relativeUrl` on the MCP server's origin → `t3_thread_send_attachments`.

Queued messages can be inspected and changed before delivery:
`t3_queue_list`, `t3_queue_read`, `t3_queue_edit`, `t3_queue_reorder`,
`t3_queue_cancel`, `t3_queue_promote_to_steer`.

### Answer a question the agent asked

When `t3_thread_read` shows `thread.pendingRequestCount` above 0 (CLI `--wait`
exits `2`), list the questions with `t3_pending_request_list`, read one with
`t3_pending_request_read`, and answer with `t3_pending_request_respond`. An
empty list with a nonzero count means the run is blocked on a permission
approval, which only the user can grant in the app: stop and tell them.

### Stop, reorganize, fork

- `t3_thread_interrupt` stops the newest interruptible run; a thread with no active turn returns without side effects.
- `t3_thread_organize` pins, snoozes (`snoozedUntil` required), settles, archives or marks unread, and each has its reverse action.
- `t3_thread_update` renames (`action:"rename"`), regenerates the title, or links/unlinks a pull request.
- `t3_thread_fork` branches from a stable run or checkpoint; `t3_thread_merge_back` brings context from a related thread back; `t3_thread_transfers` shows transfer status.
- `t3_thread_configure` changes provider, model and options of an existing thread (not its permission modes); `t3_thread_configuration` reads them.
- `t3_thread_search` finds threads by title or content, filtered to `projectId` (or the calling thread's project); outside a thread without `projectId` it searches every project.

### Scheduling and pull requests

Any client with write access can use these; outside a thread, pass `projectId`
or `threadId` explicitly.

- **Scheduling**: `schedule_task` (structured `schedule` object: interval, fixed time, or webhook), `list_scheduled_tasks`, `update_scheduled_task` (`enabled=false` pauses), `delete_scheduled_task`; `run_scheduled_task_now` needs full access.
- **Pull requests**: `link_pull_request`, `unlink_pull_request`, `list_thread_pull_requests`, `write_pull_request_guides`, `read_pull_request_guide`. `watch_pull_request` makes T3 wake the _watched thread_ on checks, comments and conflicts; inside a thread that is you, so use it instead of polling. From outside, it wakes that thread's agent, not you.

### Inside a T3 thread only

These tools act as the calling thread, so they need an agent the app started;
from an outside client they fail with `thread_credential_required`.

- **Delegation**: `delegate_task` runs one task in a T3-owned child agent with only the prompt you pass; `task_status` and `task_cancel` follow it; `create_threads` makes ordinary top-level threads instead. Choose models from `orchestrator_capabilities`.
- **Browser preview**: `preview_open` → `preview_snapshot` → `preview_click`, `preview_type`, `preview_press` and the other `preview_*` actions; `preview_status` tells you which tab you may act on. `html_preview` and `html_render` render your own HTML.
- **Devices**: `device_list` → `device_open` (returns an agent-device CLI invocation for taps and text) → `device_screenshot` → `device_close`.
- **Worktree**: `t3_worktree_status` before `t3_worktree_handoff`, which moves _your_ thread into a new worktree and ends the current turn; to give someone else a worktree use `t3_thread_launch` instead.
- **Secrets**: `request_secret` asks the user through a private card and returns a `secretRef`; the value never reaches you.

## Do not

- Do not guess pairing codes, tokens or environment addresses; ask the user.
- Do not poll `t3_thread_read` in a loop; use `t3_thread_wait` (or `watch_pull_request` for pull requests).
- Do not create a worktree through the shell for a thread; only `t3_thread_launch` and `t3_worktree_handoff` update the thread's binding.
- Do not retry a launch or send after an uncertain failure without first checking `t3_thread_list` or `t3_queue_list`.
- Do not delete projects, threads or scheduled tasks, or pass `force`, without the user's explicit confirmation; `t3_project_delete` with `force=true` deletes every thread of the project.
