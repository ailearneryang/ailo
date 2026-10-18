# Personal memory

Ailo stores durable, inspectable facts separately from conversation checkpoints,
project execution history, and companion milestones. This is an application-owned
implementation inspired by public product behavior, not a reproduction of private
ChatGPT or Claude internals.

References:
- https://learn.chatgpt.com/docs/customization/memories
- https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context
- https://support.claude.com/en/articles/12123587-import-and-export-your-memory-from-claude

## Contract

- Storage is local, partitioned by the captured account ID (or local profile),
  atomically replaced with restrictive permissions, versioned and serialized.
- Personal and project scopes are enforced by the service. Project requests may
  use personal and that project's entries, never another project's entries.
- Read, automatic extraction and per-conversation participation are independent.
  Read is enabled initially; automatic extraction requires opting in. A chat with
  memory disabled neither reads nor writes. It is still an ordinary saved chat,
  not an incognito/non-retained chat.
- Explicit writes require an exact quote from the latest real user message and
  an explicit remember/change/forget request. Model actions cannot invent source
  messages or turn quoted attachments/tool responses into durable instructions.
- Background extraction processes only newly eligible user messages. It creates
  reviewable suggestions with exact source quotes, not silently applied facts.
  No assistant messages, file bodies, tool results, scheduled or delegated prompts.
- Related topic replacements require revision checks. Changes preserve prior
  revision metadata for inspection; deletion removes the content and leaves only
  suppression hashes and source cutoffs. Reset establishes a new generation and
  cutoff; stale in-flight extraction cannot write into a new generation.
- Deleted topics are suppressed for automatic extraction/import. Explicit user
  re-add is possible. No raw deleted content is retained in audit records.
- Retrieval has a fixed character budget, ranks relevant topics and stable
  preferences, drops expired entries, and refreshes before each agent decision.
  References expose sources and scopes. Memory is context, never tool authority.
- Background work is single-flight, bounded (12 attempts/day, 8 messages/pass, first 1500 characters/message), abortable, resumes from durable
  receipts, respects account/settings changes, uses the configured model and
  reports usage/errors. It never blocks a foreground answer.
- Import is previewed and reviewed, never automatically executable. Export omits
  deleted entries and credentials. UI supports pending review, edit, expiration,
  scope filtering, source navigation, forgetting, pause and reset.

## Initial implementation boundaries

No vector service, cloud sync or screen capture. Retrieval uses deterministic
Chinese/Latin token overlap and bounded context. Model-based semantic extraction
is asynchronous; extracted suggestions require review. Sensitive/secret-looking
content is rejected defensively; a heuristic is not a guarantee of detection.
The configured model provider receives eligible text during extraction, as it
does during chat. Memory settings disclose this and extraction token usage.
Existing workspace conversations are shared by the legacy app. Memory ownership
is recorded when a conversation first participates and account mismatches fail
closed. Enabling automatic extraction never retroactively scans old messages.

## Validation

- `node --test scripts/personal-memory.test.cjs scripts/memory-worker.test.cjs scripts/memory-agent.test.cjs`
- `node --test scripts/*.test.cjs scripts/*.test.mjs` (macOS sandbox tests need a host that allows sandbox-exec)
- `npm run package`
- `PLAYWRIGHT_MODULE=/path/to/playwright node scripts/personal-memory-smoke.cjs`

The desktop smoke test uses an isolated temporary profile and a local mock model;
it verifies real IPC/tool writes and restart behavior without sending user data
to a real provider. It is not an evaluation of extraction quality on live models.
