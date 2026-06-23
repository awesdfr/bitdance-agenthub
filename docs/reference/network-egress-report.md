# Network Egress Report

The network egress report turns Network Profiles into an explainable IP/outlet control plane. It is side-effect free: it does not change system proxy settings, open network sockets, bind interfaces, or route live traffic.

## APIs

```http
GET /api/network-profiles/egress-report
GET /api/network-profiles/:id/egress-report
POST /api/network-profiles/:id/egress-live-test
```

The global report shows all Network Profiles and every known model, Agent, and CLI route. The per-profile report filters the same view to one Network Profile.

`POST /api/network-profiles/:id/egress-live-test` performs a guarded outlet IP probe. It is the production check for "which landing IP will this Network Profile use?" and is separate from the structural `/test` route.

## What It Covers

The report includes:

- direct, HTTP proxy, SOCKS5 proxy, and custom gateway profile counts
- proxy/gateway endpoint readiness
- last health-test status
- model profiles assigned to network profiles
- Agent browser/all-traffic network metadata
- CLI routes declared through `NETWORK_PROFILE_ID` or `AGENTHUB_NETWORK_PROFILE_ID`
- implicit direct egress for models without `networkProfileId`
- missing network profile references
- readiness score, gaps, warnings, and recommendations

## Readiness

```ts
type NetworkEgressReadiness =
  | 'ready'
  | 'needs_configuration'
  | 'failed'
```

`ready` means the configured routes have endpoint metadata and no known failed health status.

`needs_configuration` means one or more proxy/gateway profiles are missing `proxyUrl` or `bindInterface`, or a route references a missing profile.

`failed` means at least one profile has failed its last health check.

## v1 Behavior

v1 records and validates outlet metadata. It can verify structural configuration and record health-test results, but it does not mutate host-level proxy settings or force live traffic through a tunnel.

Model calls use `model_profiles.networkProfileId` as the explicit egress selector. Agent and CLI routing metadata is represented as profile policy/env metadata so later runtime adapters can route browser, CLI, and all-Agent traffic consistently.

## Live Egress IP Probe

Live egress probing is opt-in because it opens an external network request:

- request body must include `live=true`
- request body must include `confirmExternalCall=true`
- the process must have `AGENTHUB_ENABLE_REAL_NETWORK_EGRESS_TEST=1`

The default probe URL is `https://api.ipify.org?format=json`. A custom `probeUrl` can be supplied for customer-approved IP echo services.

Supported live routing in v1:

- `direct`: uses the host's normal outbound route
- `http_proxy`: uses the configured `proxyUrl` through the Node fetch dispatcher
- `custom_gateway`: uses the configured HTTP(S) gateway URL through the same dispatcher path

`socks5_proxy` remains structurally tracked, but live SOCKS probing is not enabled in the Node fetch adapter yet. Use an HTTP proxy or custom gateway for model traffic that needs an immediately verifiable landing IP.

The live probe writes:

- `network_profiles.healthStatus`
- `network_profiles.lastTestResult`, including the observed egress IP when detected
- `network_profiles.lastCheckedAt`
- a redacted audit log with probe host, profile mode, route type, and observed IP

## UI Usage

Model Control can use this report to show which models will use which outlet and whether those outlets have been tested.

Agent Factory can use it to warn when a customer project requires a dedicated landing IP but the Agent/browser/CLI route is still implicit direct.

Workflow preflight can use it to block live runs that reference missing or failed network profiles.
