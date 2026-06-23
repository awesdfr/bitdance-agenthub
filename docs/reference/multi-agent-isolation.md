# Multi-Agent Isolation Report

The isolation report turns Section 6 of the orchestration plan into a verifiable control-plane check. It does not open a desktop, move the mouse, launch a browser, or start a VM. It reads profile metadata, workstation records, active computer sessions, and held resource locks, then explains whether an Agent can run in parallel.

## API

```http
GET /api/agent-profiles/:id/isolation-report
```

The response shape is:

```ts
type AgentIsolationVerdict =
  | 'isolated'
  | 'needs_lock'
  | 'conflict'
  | 'not_parallel_safe'

type AgentIsolationReport = {
  agentProfile: {
    id: string
    name: string
    role: string
    status: 'draft' | 'active' | 'archived'
  }
  resolvedMode:
    | 'browser_context'
    | 'physical_desktop'
    | 'virtual_desktop'
    | 'vm'
    | 'remote_session'
  workstation: {
    configuredMode: string | null
    configuredWorkstations: Array<{
      id: string
      mode: string
      workspacePath: string
      browserProfilePath: string
      tempPath: string
      displayId: string | null
      vncUrl: string | null
      rdpConfig: string | null
      status: string
    }>
    profilePaths: {
      workspacePath: string
      browserProfilePath: string
      tempPath: string
    }
    activeSessions: Array<{
      id: string
      mode: string
      employeeRunId: string | null
      workflowRunId: string | null
      workspacePath: string
      browserProfilePath: string
      tempPath: string
      status: string
      updatedAt: number
    }>
  }
  capabilities: {
    browser: boolean
    desktop: boolean
    mobile: boolean
    cli: boolean
    software: boolean
    fileRead: boolean
    fileWrite: boolean
    commandExecution: boolean
    network: boolean
  }
  environmentIsolation: {
    workspacePerAgent: boolean
    tempPerAgent: boolean
    browserProfilePerAgent: boolean
    cliProcessPerRun: boolean
    mcpConnectionPerAgent: boolean
    softwareProfiles: string[]
    networkProfileIds: string[]
  }
  resourceLocks: {
    required: Array<{
      resourceType:
        | 'physical_mouse_keyboard'
        | 'browser_profile'
        | 'workspace_path'
        | 'file_path'
        | 'software_instance'
        | 'mobile_device'
        | 'network_profile'
      resourceId: string
      reason: string
      scope: 'agent' | 'shared' | 'runtime'
      blocksParallelism: boolean
    }>
    heldConflicts: Array<{
      resourceType: string
      resourceId: string
      ownerRunId: string
      ownerAgentId: string
      expiresAt: number
    }>
    heldByAgent: Array<{
      resourceType: string
      resourceId: string
      ownerRunId: string
      ownerAgentId: string
      expiresAt: number
    }>
  }
  concurrency: {
    verdict: AgentIsolationVerdict
    parallelSafe: boolean
    trueParallelDesktopRequiresVirtualWorkstation: boolean
    v1Behavior: string
    v2UpgradePath: string
    reasons: string[]
    warnings: string[]
    recommendations: string[]
  }
  generatedAt: number
}
```

## Verdicts

`isolated` means the Agent can be scheduled in parallel for the declared browser, CLI, workspace, MCP, and network-profile work, while still acquiring run-time locks before mutating resources.

`needs_lock` means the Agent can run, but a shared physical resource such as the real desktop or a phone must be locked before execution. This is the normal v1 behavior for physical desktop control.

`conflict` means another Agent/run already holds a required shared resource lock. The runner should wait, queue, choose another workstation, or ask the user.

`not_parallel_safe` means this same Agent already owns a held shared-resource lock, so starting another run for the same Agent may collide with its own active run.

## Section 6 Mapping

- Browser/CLI/file work is treated as truly parallel when the Agent has its own workspace, temp path, browser profile, process execution context, and MCP connection metadata.
- Physical desktop work is not treated as truly parallel in v1 because all Agents would share the same mouse and keyboard.
- The report requires a `physical_mouse_keyboard:default` lock for physical desktop Agents.
- Mobile operation requires a `mobile_device` lock.
- Software adapters require a `software_instance` lock unless future profiles declare multi-instance safety.
- v2 true desktop parallelism is represented by `virtual_desktop`, `vm`, and `remote_session` modes, with a recommendation to register workstation display/VNC/RDP metadata.

## UI Usage

Agent Factory can show the verdict beside the workstation selector. Canvas preflight can call the report for every Agent node and render:

- green for `isolated`
- yellow for `needs_lock`
- red for `conflict`
- gray/red for `not_parallel_safe`

Run Monitor can link the report to active sessions and lock owners so the user can see exactly why an Agent is waiting.
