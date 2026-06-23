# OAuth and External Service Authentication

Reasonix stores external-service access as OAuth credential records that point to encrypted secret references. A credential never needs to expose a raw access token through the Agent control plane.

## Credential Fields

| Field | Purpose |
| --- | --- |
| `provider` | `github`, `google`, `microsoft`, `notion`, `slack`, or `custom`. |
| `grantType` | `authorization_code`, `client_credentials`, or `device_code`. |
| `accessTokenSecretRef` | Secret vault reference for the encrypted access token. |
| `refreshTokenSecretRef` | Optional secret vault reference for refresh. |
| `scopes` | Provider scopes allowed for this credential. |
| `actingAs` | `user`, `service_account`, or `bot`. |
| `allowedOperations` | Product-level operation allowlist such as `repo.read` or `pages.read`. |
| `requiresUserConsent` | Forces an approval step before an Agent uses the credential. |
| `shared` | Allows one token to be used by multiple Agents when enabled. |
| `agentProfileId` | Binds a non-shared token to one Agent. |

## Refresh Failure Flow

1. Agent tries to refresh a near-expiry or expired token.
2. Refresh fails.
3. The credential moves to `reauth_required`.
4. The current Agent run is paused and a refresh event records `pausedRunId`.
5. The user completes the OAuth flow outside the Agent runtime.
6. Reauthorization replaces token secret references, clears pause metadata, and allows the run to resume.

## Operation Evaluation

Before use, the runtime evaluates:

- credential status
- shared or Agent-scoped identity
- allowed operation
- required provider scope
- expiry and auto-refresh window
- user-consent requirement

The result tells the runtime whether to execute, refresh, ask for consent, request reauthorization, or block.
