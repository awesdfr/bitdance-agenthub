# Browser Sessions

Section 190 adds persistent browser-session metadata for Agents that need login state across tasks. The v1 implementation stores encrypted state references and policy metadata, not raw cookies.

## Data Model

- `browser_sessions` stores the session name, owner Agent, shared Agent IDs, CookieJar/localStorage/IndexedDB references, encryption flags, lifecycle policy, keep-alive policy, blocked domains, expiry, and status.
- `browser_session_events` records creation, access evaluations, keep-alive planning, export planning, revocation, and expiry.

## Security Defaults

- `encrypted` defaults to `true`.
- `encryptSensitiveCookies` defaults to `true`.
- `isolateByAgent` defaults to `true`.
- Access is allowed only for the owner Agent or Agents listed in `sharedWithAgentProfileIds`.
- Blocked domains are checked before a session is handed to a browser automation runtime.

## Lifecycle

The session can persist after a task and has a max age of `1d`, `7d`, `30d`, or `forever`. When `expiresAt` has passed, access evaluation marks the session `expired`.

## Keep-Alive

The keep-alive planner records whether a refresh visit is due. It returns the interval, visit URLs, and next due time, but it does not open a browser or touch a live account.

## Export

Export is a manifest-only plan. It requires `exportable`, `encrypted`, and `encryptSensitiveCookies` to be enabled and returns references such as `cookieJarRef`; it does not expose cookie values.
