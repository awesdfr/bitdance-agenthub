/**
 * DB 启动期自举：建表 + 自动 seed 内置 agent。
 *
 * 设计意图：
 *  - 打包后桌面版第一次启动时，userData 里只有空 DB 文件，没有任何表 / 数据。
 *    本模块在 client.ts 初始化 drizzle 之前同步建表（CREATE TABLE IF NOT EXISTS）。
 *  - 内置 agent 也在此自动 seed —— 不再需要用户手动 `pnpm db:seed`（packaged 应用里也没有 pnpm 可用）。
 *
 * 全部用 better-sqlite3 原生同步 API：
 *  - CJS 标准下 `client.ts` 模块顶层不能 await；drizzle 的 query API 全是 Promise，没法在 module-init 阶段调
 *  - better-sqlite3 是同步的 native binding，prepare/run 立即返回，对 sub-ms 启动期开销可忽略
 *
 * 幂等：
 *  - CREATE TABLE IF NOT EXISTS 不重复建表
 *  - seed 前先查 is_builtin=1 是否已有记录，已有就跳过
 *
 * 详见 Spec 12 §5 / §6 与 Spec 08。
 */
import type Database from 'better-sqlite3'

import { BUILTIN_AGENTS, UI_DESIGNER_ARTIFACT_PROMPT_HINT } from './builtin-agents'

const FRONTEND_DEPLOYMENT_PROMPT_HINT =
  'deploy_artifact / deploy_workspace 返回的 previewPath 是当前 AgentHub 实例下的相对路径，不要在文字总结里把它改写成公网域名或自造完整 URL；让用户点击部署卡片按钮，或原样引用 previewPath。'
const FRONTEND_LOCAL_WORKSPACE_PROMPT_HINT =
  '当 workspace_info mode=local 且用户要求创建 / 修改 / 初始化 / 调试前端项目、源码文件、依赖或构建配置时，优先使用 fs_read / fs_write / bash 直接操作本地文件并运行验证；不要用 write_artifact 代替应该落盘的源码。构建出 dist/build/out 等静态目录后，可用 deploy_workspace 生成部署预览卡。只有用户明确要求网页产物、可预览原型、artifact 或独立 demo 时，才用 write_artifact + deploy_artifact。'
const REVIEWER_LOCAL_WORKSPACE_PROMPT_HINT =
  '本地代码审查先用 fs_read 查看关键文件，必要时用 bash 运行检查命令；不要只根据文件名、任务摘要或 artifact 占位做判断。'
const BUILTIN_TOOL_UPGRADES = new Map(
  BUILTIN_AGENTS.map((agent) => [agent.id, agent.toolNames] as const),
)

const DDL: string[] = [
  // ─── agents ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL,
    description TEXT NOT NULL,
    capabilities TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    adapter_name TEXT NOT NULL,
    model_provider TEXT,
    model_id TEXT,
    api_key TEXT,
    api_base_url TEXT,
    tool_names TEXT NOT NULL,
    skill_ids TEXT NOT NULL DEFAULT '[]',
    mcp_server_ids TEXT NOT NULL DEFAULT '[]',
    cli_profile_ids TEXT NOT NULL DEFAULT '[]',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    is_orchestrator INTEGER NOT NULL DEFAULT 0,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,

  // ─── conversations ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    agent_ids TEXT NOT NULL,
    model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    pinned_message_ids TEXT NOT NULL DEFAULT '[]',
    bookmarked_message_ids TEXT NOT NULL DEFAULT '[]',
    archived INTEGER NOT NULL DEFAULT 0,
    pinned_at INTEGER,
    fs_write_approval_mode TEXT NOT NULL DEFAULT 'review',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conv_updated ON conversations(updated_at)`,

  // ─── messages ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    agent_id TEXT REFERENCES agents(id),
    parts TEXT NOT NULL,
    status TEXT NOT NULL,
    parent_message_id TEXT,
    mentioned_agent_ids TEXT NOT NULL DEFAULT '[]',
    run_id TEXT,
    usage TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at)`,

  // ─── artifacts ─────────────────────────────────
  `CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    parent_artifact_id TEXT,
    created_by_agent_id TEXT NOT NULL REFERENCES agents(id),
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifacts_conv ON artifacts(conversation_id)`,
  `CREATE TABLE IF NOT EXISTS artifact_semantic_diffs (
    id TEXT PRIMARY KEY,
    artifact_v1_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    artifact_v2_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    structural_changes TEXT NOT NULL DEFAULT '[]',
    semantic_changes TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL,
    risks TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_semantic_diffs_pair
    ON artifact_semantic_diffs(artifact_v1_id, artifact_v2_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_semantic_diffs_artifact_v2
    ON artifact_semantic_diffs(artifact_v2_id, created_at)`,

  // ─── workspaces ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    root_path TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'sandbox',
    bound_path TEXT,
    created_at INTEGER NOT NULL
  )`,

  // ─── attachments ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    size INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_conv ON attachments(conversation_id)`,

  // ─── agent_runs ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL REFERENCES agents(id),
    trigger_message_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    parent_run_id TEXT,
    usage TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runs_parent ON agent_runs(parent_run_id)`,

  // ─── conversation_context_summaries ─────────────────────────
  `CREATE TABLE IF NOT EXISTS conversation_context_summaries (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    covered_until_message_id TEXT NOT NULL,
    covered_until_created_at INTEGER NOT NULL,
    source_message_count INTEGER NOT NULL,
    token_estimate INTEGER NOT NULL,
    model_provider TEXT,
    model_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_summaries_conv_created ON conversation_context_summaries(conversation_id, created_at)`,

  // ─── app_settings ──────────────────────────────
  `CREATE TABLE IF NOT EXISTS app_settings (
    id TEXT PRIMARY KEY,
    anthropic_api_key TEXT,
    anthropic_base_url TEXT,
    openai_api_key TEXT,
    deepseek_api_key TEXT,
    ark_api_key TEXT,
    companion_mode TEXT NOT NULL DEFAULT 'off',
    mobile_device_token TEXT,
    deployment_publish_enabled INTEGER NOT NULL DEFAULT 0,
    deployment_publish_dir TEXT,
    deployment_public_base_url TEXT,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS network_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'direct',
    proxy_url TEXT,
    bind_interface TEXT,
    region_label TEXT,
    applies_to TEXT NOT NULL DEFAULT 'model_only',
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_test_result TEXT,
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS model_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key_ref TEXT NOT NULL,
    model TEXT NOT NULL,
    context_window INTEGER,
    supports_vision INTEGER NOT NULL DEFAULT 0,
    supports_tool_calling INTEGER NOT NULL DEFAULT 0,
    supports_json_mode INTEGER NOT NULL DEFAULT 0,
    network_profile_id TEXT REFERENCES network_profiles(id) ON DELETE SET NULL,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_test_result TEXT,
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_profiles_provider ON model_profiles(provider)`,

  `CREATE TABLE IF NOT EXISTS model_connection_tests (
    id TEXT PRIMARY KEY,
    model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'dry_run',
    status TEXT NOT NULL,
    latency_ms INTEGER,
    message TEXT NOT NULL,
    capability_checks TEXT NOT NULL DEFAULT '{}',
    network_profile_id TEXT REFERENCES network_profiles(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_connection_tests_profile
    ON model_connection_tests(model_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_connection_tests_status
    ON model_connection_tests(status)`,

  `CREATE TABLE IF NOT EXISTS cli_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    command TEXT NOT NULL,
    args_template TEXT NOT NULL DEFAULT '',
    cwd_policy TEXT NOT NULL DEFAULT 'workspace',
    custom_cwd TEXT,
    env TEXT NOT NULL DEFAULT '{}',
    timeout_ms INTEGER NOT NULL DEFAULT 120000,
    input_mode TEXT NOT NULL DEFAULT 'args',
    output_mode TEXT NOT NULL DEFAULT 'stdout',
    allowed_agent_ids TEXT NOT NULL DEFAULT '[]',
    requires_approval INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_test_result TEXT,
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS tool_connections (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_test_result TEXT,
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS mcp_servers (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    transport TEXT NOT NULL DEFAULT 'stdio',
    command TEXT,
    args TEXT NOT NULL DEFAULT '[]',
    env TEXT NOT NULL DEFAULT '{}',
    endpoint TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_test_result TEXT,
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled)`,

  `CREATE TABLE IF NOT EXISTS mcp_tool_definitions (
    id TEXT PRIMARY KEY,
    mcp_server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    input_schema TEXT NOT NULL DEFAULT '{}',
    output_schema TEXT NOT NULL DEFAULT '{}',
    annotations TEXT NOT NULL DEFAULT '{}',
    risk_level TEXT NOT NULL DEFAULT 'medium',
    requires_approval INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    discovered_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_tool_definitions_server
    ON mcp_tool_definitions(mcp_server_id, tool_name)`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_tool_definitions_enabled
    ON mcp_tool_definitions(enabled)`,

  `CREATE TABLE IF NOT EXISTS tool_protocol_manifests (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    input_schema TEXT NOT NULL DEFAULT '{}',
    idempotent INTEGER NOT NULL DEFAULT 0,
    read_only INTEGER NOT NULL DEFAULT 0,
    destructive INTEGER NOT NULL DEFAULT 0,
    long_running INTEGER NOT NULL DEFAULT 0,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    risk_level TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_protocol_manifests_name
    ON tool_protocol_manifests(name)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_protocol_manifests_source
    ON tool_protocol_manifests(source, status)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_protocol_manifests_risk
    ON tool_protocol_manifests(risk_level, requires_approval)`,

  `CREATE TABLE IF NOT EXISTS tool_protocol_invocations (
    id TEXT PRIMARY KEY,
    manifest_id TEXT NOT NULL REFERENCES tool_protocol_manifests(id) ON DELETE CASCADE,
    call_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    arguments_json TEXT NOT NULL DEFAULT '{}',
    idempotency_key TEXT,
    status TEXT NOT NULL DEFAULT 'created',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_protocol_invocations_call
    ON tool_protocol_invocations(call_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_protocol_invocations_manifest
    ON tool_protocol_invocations(manifest_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_protocol_invocations_idempotency
    ON tool_protocol_invocations(idempotency_key)`,

  `CREATE TABLE IF NOT EXISTS tool_protocol_results (
    id TEXT PRIMARY KEY,
    invocation_id TEXT NOT NULL REFERENCES tool_protocol_invocations(id) ON DELETE CASCADE,
    call_id TEXT NOT NULL,
    success INTEGER NOT NULL,
    data TEXT,
    error TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tool_protocol_results_invocation
    ON tool_protocol_results(invocation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_protocol_results_call
    ON tool_protocol_results(call_id, success)`,

  `CREATE TABLE IF NOT EXISTS skills (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL,
    source_url TEXT NOT NULL,
    manifest TEXT NOT NULL DEFAULT '{}',
    install_path TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'installed',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status)`,

  `CREATE TABLE IF NOT EXISTS skill_install_flows (
    id TEXT PRIMARY KEY,
    skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL,
    manifest TEXT NOT NULL DEFAULT '{}',
    install_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skill_install_flows_status ON skill_install_flows(status)`,

  `CREATE TABLE IF NOT EXISTS skill_sdk_manifests (
    id TEXT PRIMARY KEY,
    skill_id TEXT REFERENCES skills(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '[]',
    dependencies TEXT NOT NULL DEFAULT '{}',
    permissions TEXT NOT NULL DEFAULT '[]',
    required_files TEXT NOT NULL DEFAULT '[]',
    scaffold_files TEXT NOT NULL DEFAULT '[]',
    manifest TEXT NOT NULL DEFAULT '{}',
    validation_status TEXT NOT NULL DEFAULT 'invalid',
    validation_findings TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skill_sdk_manifests_skill
    ON skill_sdk_manifests(skill_id)`,
  `CREATE INDEX IF NOT EXISTS idx_skill_sdk_manifests_name_version
    ON skill_sdk_manifests(name, version)`,
  `CREATE INDEX IF NOT EXISTS idx_skill_sdk_manifests_status
    ON skill_sdk_manifests(validation_status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS skill_marketplace_publications (
    id TEXT PRIMARY KEY,
    manifest_id TEXT NOT NULL REFERENCES skill_sdk_manifests(id) ON DELETE CASCADE,
    marketplace_url TEXT NOT NULL,
    package_name TEXT NOT NULL,
    package_version TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    submission_payload TEXT NOT NULL DEFAULT '{}',
    validation_snapshot TEXT NOT NULL DEFAULT '{}',
    published_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skill_marketplace_publications_manifest
    ON skill_marketplace_publications(manifest_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_skill_marketplace_publications_package
    ON skill_marketplace_publications(package_name, package_version)`,

  `CREATE TABLE IF NOT EXISTS plugin_packages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'local',
    extension_points TEXT NOT NULL DEFAULT '[]',
    capabilities TEXT NOT NULL DEFAULT '[]',
    config TEXT NOT NULL DEFAULT '{}',
    marketplace_metadata TEXT NOT NULL DEFAULT '{}',
    compatibility_report TEXT NOT NULL DEFAULT '{}',
    security_scan_result TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'installed',
    health_status TEXT NOT NULL DEFAULT 'unknown',
    health_message TEXT NOT NULL DEFAULT '',
    installed_at INTEGER NOT NULL,
    enabled_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plugin_packages_status
    ON plugin_packages(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_plugin_packages_name_version
    ON plugin_packages(name, version)`,
  `CREATE INDEX IF NOT EXISTS idx_plugin_packages_source
    ON plugin_packages(source)`,

  `CREATE TABLE IF NOT EXISTS plugin_lifecycle_events (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL REFERENCES plugin_packages(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    from_version TEXT,
    to_version TEXT,
    status TEXT NOT NULL DEFAULT 'succeeded',
    message TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_events_plugin
    ON plugin_lifecycle_events(plugin_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_plugin_lifecycle_events_type
    ON plugin_lifecycle_events(event_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS team_users (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL,
    role_system TEXT NOT NULL DEFAULT 'viewer',
    permissions TEXT NOT NULL DEFAULT '{}',
    scope TEXT NOT NULL DEFAULT 'global',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_users_email
    ON team_users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_team_users_role_status
    ON team_users(role_system, status)`,

  `CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_teams_status
    ON teams(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS team_memberships (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES team_users(id) ON DELETE CASCADE,
    role_system TEXT NOT NULL DEFAULT 'viewer',
    permissions TEXT NOT NULL DEFAULT '{}',
    scope TEXT NOT NULL DEFAULT 'global',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_memberships_team
    ON team_memberships(team_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_team_memberships_user
    ON team_memberships(user_id, status)`,

  `CREATE TABLE IF NOT EXISTS team_resource_shares (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    sharing_policy TEXT NOT NULL DEFAULT 'team_shared',
    secret_handling TEXT NOT NULL DEFAULT 'not_applicable',
    created_by_user_id TEXT REFERENCES team_users(id) ON DELETE SET NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_resource_shares_team
    ON team_resource_shares(team_id, resource_type)`,
  `CREATE INDEX IF NOT EXISTS idx_team_resource_shares_resource
    ON team_resource_shares(resource_type, resource_id)`,

  `CREATE TABLE IF NOT EXISTS team_approval_policies (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    approval_mode TEXT NOT NULL,
    approver_user_ids TEXT NOT NULL DEFAULT '[]',
    required_permission TEXT NOT NULL DEFAULT 'approval:decide',
    risk_level TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_approval_policies_team
    ON team_approval_policies(team_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_team_approval_policies_mode
    ON team_approval_policies(approval_mode, risk_level)`,

  `CREATE TABLE IF NOT EXISTS team_approval_decisions (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES team_approval_policies(id) ON DELETE CASCADE,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    user_id TEXT NOT NULL REFERENCES team_users(id) ON DELETE CASCADE,
    decision TEXT NOT NULL,
    comment TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_team_approval_decisions_policy
    ON team_approval_decisions(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_team_approval_decisions_user
    ON team_approval_decisions(user_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_template_packages (
    id TEXT PRIMARY KEY,
    template_key TEXT NOT NULL,
    template_type TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'custom',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    required_skill_ids TEXT NOT NULL DEFAULT '[]',
    recommended_tool_ids TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    author TEXT NOT NULL DEFAULT 'Reasonix',
    source TEXT NOT NULL DEFAULT 'system',
    visibility TEXT NOT NULL DEFAULT 'public',
    marketplace_url TEXT,
    status TEXT NOT NULL DEFAULT 'published',
    install_count INTEGER NOT NULL DEFAULT 0,
    rating REAL,
    created_by_user_id TEXT REFERENCES team_users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_template_packages_key
    ON agent_template_packages(template_key)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_template_packages_type
    ON agent_template_packages(template_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_template_packages_category
    ON agent_template_packages(category, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_template_packages_source
    ON agent_template_packages(source, visibility)`,

  `CREATE TABLE IF NOT EXISTS agent_template_installs (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES agent_template_packages(id) ON DELETE CASCADE,
    installed_by_user_id TEXT REFERENCES team_users(id) ON DELETE SET NULL,
    target_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'installed',
    created_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    created_workflow_id TEXT,
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_template_installs_template
    ON agent_template_installs(template_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_template_installs_user
    ON agent_template_installs(installed_by_user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_template_installs_target
    ON agent_template_installs(target_type, status)`,

  `CREATE TABLE IF NOT EXISTS test_strategy_items (
    id TEXT PRIMARY KEY,
    item_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    expected_coverage TEXT NOT NULL DEFAULT '',
    evidence_refs TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_test_strategy_items_key
    ON test_strategy_items(item_key)`,
  `CREATE INDEX IF NOT EXISTS idx_test_strategy_items_kind_status
    ON test_strategy_items(kind, status)`,

  `CREATE TABLE IF NOT EXISTS test_fixture_specs (
    id TEXT PRIMARY KEY,
    fixture_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    content_kind TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_test_fixture_specs_type
    ON test_fixture_specs(fixture_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_test_fixture_specs_name
    ON test_fixture_specs(name)`,

  `CREATE TABLE IF NOT EXISTS test_fixture_generation_runs (
    id TEXT PRIMARY KEY,
    fixture_id TEXT NOT NULL REFERENCES test_fixture_specs(id) ON DELETE CASCADE,
    target_path TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    generated_files TEXT NOT NULL DEFAULT '[]',
    generated_bytes INTEGER NOT NULL DEFAULT 0,
    result_summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_test_fixture_generation_runs_fixture
    ON test_fixture_generation_runs(fixture_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_test_fixture_generation_runs_status
    ON test_fixture_generation_runs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS benchmark_suites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    schedule TEXT NOT NULL DEFAULT 'manual',
    ci_enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_suites_name
    ON benchmark_suites(name)`,

  `CREATE TABLE IF NOT EXISTS benchmark_cases (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL REFERENCES benchmark_suites(id) ON DELETE CASCADE,
    dimension TEXT NOT NULL,
    name TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    expected_output TEXT NOT NULL DEFAULT '{}',
    validation_fn TEXT NOT NULL,
    max_budget_cents INTEGER NOT NULL DEFAULT 0,
    max_steps INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_cases_suite
    ON benchmark_cases(suite_id, dimension)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_cases_tags
    ON benchmark_cases(dimension)`,

  `CREATE TABLE IF NOT EXISTS benchmark_runs (
    id TEXT PRIMARY KEY,
    suite_id TEXT NOT NULL REFERENCES benchmark_suites(id) ON DELETE CASCADE,
    prompt_version TEXT NOT NULL,
    baseline_prompt_version TEXT NOT NULL,
    model_profile_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'queued',
    prompt_drift_detected INTEGER NOT NULL DEFAULT 0,
    ci_regression_status TEXT NOT NULL DEFAULT 'passed',
    summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_runs_suite
    ON benchmark_runs(suite_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status
    ON benchmark_runs(status, ci_regression_status)`,

  `CREATE TABLE IF NOT EXISTS benchmark_case_results (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
    case_id TEXT NOT NULL REFERENCES benchmark_cases(id) ON DELETE CASCADE,
    model_profile_id TEXT NOT NULL,
    passed INTEGER NOT NULL,
    score REAL NOT NULL,
    budget_cents INTEGER NOT NULL,
    steps INTEGER NOT NULL,
    observed_output TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_case_results_run
    ON benchmark_case_results(run_id, model_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_benchmark_case_results_case
    ON benchmark_case_results(case_id, passed)`,

  `CREATE TABLE IF NOT EXISTS localization_settings (
    id TEXT PRIMARY KEY,
    default_locale TEXT NOT NULL DEFAULT 'zh-CN',
    fallback_locale TEXT NOT NULL DEFAULT 'zh-CN',
    enabled_locales TEXT NOT NULL DEFAULT '["zh-CN","en-US","ja-JP","zh-TW"]',
    namespaces TEXT NOT NULL DEFAULT '["ui","errors","agent-prompts","docs"]',
    output_language_policy TEXT NOT NULL DEFAULT 'workspace_default',
    date_time_format TEXT NOT NULL DEFAULT '{}',
    number_format TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_localization_settings_default
    ON localization_settings(default_locale, fallback_locale)`,

  `CREATE TABLE IF NOT EXISTS localization_resources (
    id TEXT PRIMARY KEY,
    locale TEXT NOT NULL,
    namespace TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_localization_resources_lookup
    ON localization_resources(locale, namespace, key)`,
  `CREATE INDEX IF NOT EXISTS idx_localization_resources_namespace
    ON localization_resources(namespace, status)`,

  `CREATE TABLE IF NOT EXISTS agent_localization_policies (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE CASCADE,
    output_language_policy TEXT NOT NULL DEFAULT 'workspace_default',
    output_locale TEXT NOT NULL DEFAULT 'zh-CN',
    date_time_locale TEXT NOT NULL DEFAULT 'zh-CN',
    number_locale TEXT NOT NULL DEFAULT 'zh-CN',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_localization_policies_agent
    ON agent_localization_policies(agent_profile_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_localization_policies_locale
    ON agent_localization_policies(output_locale, output_language_policy)`,

  `CREATE TABLE IF NOT EXISTS i18n_contract_checks (
    id TEXT PRIMARY KEY,
    check_key TEXT NOT NULL,
    area TEXT NOT NULL,
    description TEXT NOT NULL,
    namespace TEXT,
    required_keys TEXT NOT NULL DEFAULT '[]',
    required_locales TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'warning',
    evidence TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_i18n_contract_checks_key
    ON i18n_contract_checks(check_key)`,
  `CREATE INDEX IF NOT EXISTS idx_i18n_contract_checks_area
    ON i18n_contract_checks(area, status)`,

  `CREATE TABLE IF NOT EXISTS architecture_evolution_reservations (
    id TEXT PRIMARY KEY,
    track TEXT NOT NULL,
    abstraction_kind TEXT NOT NULL,
    abstraction_name TEXT NOT NULL,
    current_implementation TEXT NOT NULL,
    future_implementation TEXT NOT NULL,
    migration_trigger TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'reserved',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_architecture_evolution_track
    ON architecture_evolution_reservations(track, status)`,
  `CREATE INDEX IF NOT EXISTS idx_architecture_evolution_abstraction
    ON architecture_evolution_reservations(abstraction_kind, abstraction_name)`,

  `CREATE TABLE IF NOT EXISTS theme_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    preset_key TEXT NOT NULL,
    follow_system INTEGER NOT NULL DEFAULT 0,
    mode_preference TEXT NOT NULL DEFAULT 'system',
    color_tokens TEXT NOT NULL DEFAULT '{}',
    font_tokens TEXT NOT NULL DEFAULT '{}',
    radius_px INTEGER NOT NULL DEFAULT 8,
    spacing_scale TEXT NOT NULL DEFAULT 'comfortable',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_theme_profiles_preset
    ON theme_profiles(preset_key, status)`,
  `CREATE INDEX IF NOT EXISTS idx_theme_profiles_mode
    ON theme_profiles(mode_preference, follow_system)`,

  `CREATE TABLE IF NOT EXISTS keyboard_shortcuts (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    action TEXT NOT NULL,
    keys TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    prevent_default INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_keyboard_shortcuts_scope
    ON keyboard_shortcuts(scope, status)`,
  `CREATE INDEX IF NOT EXISTS idx_keyboard_shortcuts_action
    ON keyboard_shortcuts(action)`,

  `CREATE TABLE IF NOT EXISTS accessibility_profiles (
    id TEXT PRIMARY KEY,
    profile_key TEXT NOT NULL,
    name TEXT NOT NULL,
    keyboard_navigation INTEGER NOT NULL DEFAULT 1,
    screen_reader_support INTEGER NOT NULL DEFAULT 1,
    high_contrast_mode INTEGER NOT NULL DEFAULT 0,
    font_scale REAL NOT NULL DEFAULT 1,
    color_scheme TEXT NOT NULL DEFAULT 'system',
    theme_profile_id TEXT REFERENCES theme_profiles(id) ON DELETE SET NULL,
    check_results TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_accessibility_profiles_key
    ON accessibility_profiles(profile_key)`,
  `CREATE INDEX IF NOT EXISTS idx_accessibility_profiles_status
    ON accessibility_profiles(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS reasonix_file_format_specs (
    id TEXT PRIMARY KEY,
    format_kind TEXT NOT NULL,
    extension TEXT NOT NULL,
    display_name TEXT NOT NULL,
    schema_version TEXT NOT NULL,
    required_fields TEXT NOT NULL DEFAULT '[]',
    metadata_schema TEXT NOT NULL DEFAULT '{}',
    checksum_algorithm TEXT NOT NULL DEFAULT 'sha256',
    signature_optional INTEGER NOT NULL DEFAULT 1,
    secret_refs_forbidden INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reasonix_file_format_specs_kind
    ON reasonix_file_format_specs(format_kind, status)`,
  `CREATE INDEX IF NOT EXISTS idx_reasonix_file_format_specs_extension
    ON reasonix_file_format_specs(extension)`,

  `CREATE TABLE IF NOT EXISTS reasonix_file_validations (
    id TEXT PRIMARY KEY,
    format_kind TEXT NOT NULL,
    extension TEXT NOT NULL,
    schema_version TEXT,
    checksum TEXT,
    signature_present INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    findings TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    payload_summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reasonix_file_validations_kind
    ON reasonix_file_validations(format_kind, status)`,
  `CREATE INDEX IF NOT EXISTS idx_reasonix_file_validations_created
    ON reasonix_file_validations(created_at)`,

  `CREATE TABLE IF NOT EXISTS migration_wizard_sessions (
    id TEXT PRIMARY KEY,
    source_tool TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'checked',
    compatibility_status TEXT NOT NULL DEFAULT 'warning',
    source_payload TEXT NOT NULL DEFAULT '{}',
    compatibility_report TEXT NOT NULL DEFAULT '{}',
    imported_counts TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    imported_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_wizard_sessions_source
    ON migration_wizard_sessions(source_tool, status)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_wizard_sessions_compat
    ON migration_wizard_sessions(compatibility_status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS migration_import_records (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES migration_wizard_sessions(id) ON DELETE CASCADE,
    source_tool TEXT NOT NULL,
    source_id TEXT,
    target_type TEXT NOT NULL,
    target_id TEXT,
    source_tag TEXT NOT NULL,
    result TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_migration_import_records_session
    ON migration_import_records(session_id, result)`,
  `CREATE INDEX IF NOT EXISTS idx_migration_import_records_target
    ON migration_import_records(target_type, target_id)`,

  `CREATE TABLE IF NOT EXISTS performance_analysis_runs (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'completed',
    window_start INTEGER,
    window_end INTEGER,
    p50_latency_ms INTEGER NOT NULL DEFAULT 0,
    p95_latency_ms INTEGER NOT NULL DEFAULT 0,
    p99_latency_ms INTEGER NOT NULL DEFAULT 0,
    slowest_steps TEXT NOT NULL DEFAULT '[]',
    slowest_tools TEXT NOT NULL DEFAULT '[]',
    sqlite_slow_queries TEXT NOT NULL DEFAULT '[]',
    memory_flamegraph TEXT NOT NULL DEFAULT '{}',
    process_metrics TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_performance_analysis_runs_scope
    ON performance_analysis_runs(scope, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_performance_analysis_runs_agent
    ON performance_analysis_runs(agent_profile_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS performance_optimization_recommendations (
    id TEXT PRIMARY KEY,
    analysis_run_id TEXT NOT NULL REFERENCES performance_analysis_runs(id) ON DELETE CASCADE,
    recommendation_type TEXT NOT NULL,
    target TEXT NOT NULL,
    message TEXT NOT NULL,
    estimated_impact TEXT NOT NULL DEFAULT 'medium',
    evidence TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_performance_recommendations_run
    ON performance_optimization_recommendations(analysis_run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_performance_recommendations_target
    ON performance_optimization_recommendations(target, status)`,

  `CREATE TABLE IF NOT EXISTS security_audit_checklist_items (
    id TEXT PRIMARY KEY,
    cadence TEXT NOT NULL,
    item_key TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    required INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_items_key
    ON security_audit_checklist_items(item_key)`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_items_cadence
    ON security_audit_checklist_items(cadence, status)`,

  `CREATE TABLE IF NOT EXISTS security_audit_runs (
    id TEXT PRIMARY KEY,
    cadence TEXT NOT NULL,
    release_label TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_runs_cadence
    ON security_audit_runs(cadence, status)`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_runs_created
    ON security_audit_runs(created_at)`,

  `CREATE TABLE IF NOT EXISTS security_audit_run_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES security_audit_runs(id) ON DELETE CASCADE,
    checklist_item_id TEXT REFERENCES security_audit_checklist_items(id) ON DELETE SET NULL,
    item_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    evidence TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_run_items_run
    ON security_audit_run_items(run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_security_audit_run_items_key
    ON security_audit_run_items(item_key)`,

  `CREATE TABLE IF NOT EXISTS incident_response_plans (
    id TEXT PRIMARY KEY,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    response_window_minutes INTEGER NOT NULL,
    trigger_examples TEXT NOT NULL DEFAULT '[]',
    action_sequence TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_incident_response_plans_severity
    ON incident_response_plans(severity, status)`,
  `CREATE INDEX IF NOT EXISTS idx_incident_response_plans_window
    ON incident_response_plans(response_window_minutes)`,

  `CREATE TABLE IF NOT EXISTS incident_reports (
    id TEXT PRIMARY KEY,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    trigger TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    response_plan_id TEXT REFERENCES incident_response_plans(id) ON DELETE SET NULL,
    affected_resources TEXT NOT NULL DEFAULT '[]',
    evidence TEXT NOT NULL DEFAULT '{}',
    response_summary TEXT NOT NULL DEFAULT '{}',
    opened_at INTEGER NOT NULL,
    due_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_incident_reports_severity
    ON incident_reports(severity, status)`,
  `CREATE INDEX IF NOT EXISTS idx_incident_reports_due
    ON incident_reports(due_at, status)`,

  `CREATE TABLE IF NOT EXISTS incident_response_actions (
    id TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incident_reports(id) ON DELETE CASCADE,
    action_key TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    required INTEGER NOT NULL DEFAULT 1,
    due_at INTEGER NOT NULL,
    completed_at INTEGER,
    evidence TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_incident_response_actions_incident
    ON incident_response_actions(incident_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_incident_response_actions_key
    ON incident_response_actions(action_key)`,

  `CREATE TABLE IF NOT EXISTS capacity_planning_profiles (
    id TEXT PRIMARY KEY,
    tier_key TEXT NOT NULL,
    memory_gb INTEGER NOT NULL,
    cpu_cores INTEGER NOT NULL,
    gpu_required INTEGER NOT NULL DEFAULT 0,
    max_agents INTEGER NOT NULL,
    max_browsers INTEGER NOT NULL,
    persona TEXT NOT NULL,
    database_guidance TEXT NOT NULL DEFAULT '',
    storage_guidance TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_capacity_profiles_tier
    ON capacity_planning_profiles(tier_key)`,
  `CREATE INDEX IF NOT EXISTS idx_capacity_profiles_specs
    ON capacity_planning_profiles(memory_gb, cpu_cores, gpu_required)`,

  `CREATE TABLE IF NOT EXISTS capacity_planning_evaluations (
    id TEXT PRIMARY KEY,
    memory_gb INTEGER NOT NULL,
    cpu_cores INTEGER NOT NULL,
    has_gpu INTEGER NOT NULL DEFAULT 0,
    desired_agents INTEGER NOT NULL DEFAULT 0,
    desired_browsers INTEGER NOT NULL DEFAULT 0,
    agent_count INTEGER NOT NULL DEFAULT 0,
    memories_per_agent INTEGER NOT NULL DEFAULT 0,
    task_count INTEGER NOT NULL DEFAULT 0,
    matched_profile_id TEXT REFERENCES capacity_planning_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    estimate TEXT NOT NULL DEFAULT '{}',
    warnings TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_capacity_evaluations_status
    ON capacity_planning_evaluations(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_capacity_evaluations_profile
    ON capacity_planning_evaluations(matched_profile_id)`,

  `CREATE TABLE IF NOT EXISTS deprecation_policy_stages (
    id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    sequence_index INTEGER NOT NULL,
    months_from_notice INTEGER NOT NULL,
    runtime_behavior TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deprecation_policy_stages_stage
    ON deprecation_policy_stages(stage)`,
  `CREATE INDEX IF NOT EXISTS idx_deprecation_policy_stages_sequence
    ON deprecation_policy_stages(sequence_index)`,

  `CREATE TABLE IF NOT EXISTS feature_deprecations (
    id TEXT PRIMARY KEY,
    feature_key TEXT NOT NULL,
    feature_name TEXT NOT NULL,
    current_stage TEXT NOT NULL DEFAULT 'notice',
    replacement_feature TEXT,
    migration_guide TEXT NOT NULL DEFAULT '',
    auto_migrate_available INTEGER NOT NULL DEFAULT 0,
    notice_at INTEGER NOT NULL,
    warning_at INTEGER NOT NULL,
    disabled_new_at INTEGER NOT NULL,
    removed_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feature_deprecations_key
    ON feature_deprecations(feature_key)`,
  `CREATE INDEX IF NOT EXISTS idx_feature_deprecations_stage
    ON feature_deprecations(current_stage, status)`,

  `CREATE TABLE IF NOT EXISTS deprecation_migration_runs (
    id TEXT PRIMARY KEY,
    feature_deprecation_id TEXT NOT NULL REFERENCES feature_deprecations(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'dry_run',
    status TEXT NOT NULL DEFAULT 'planned',
    migrated_count INTEGER NOT NULL DEFAULT 0,
    report TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_deprecation_migration_runs_feature
    ON deprecation_migration_runs(feature_deprecation_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_deprecation_migration_runs_mode
    ON deprecation_migration_runs(mode, created_at)`,

  `CREATE TABLE IF NOT EXISTS documentation_sections (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    directory TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    topic_slugs TEXT NOT NULL DEFAULT '[]',
    owner_audience TEXT NOT NULL DEFAULT 'users',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documentation_sections_category
    ON documentation_sections(category, status)`,
  `CREATE INDEX IF NOT EXISTS idx_documentation_sections_directory
    ON documentation_sections(directory)`,

  `CREATE TABLE IF NOT EXISTS documentation_pages (
    id TEXT PRIMARY KEY,
    section_id TEXT NOT NULL REFERENCES documentation_sections(id) ON DELETE CASCADE,
    category TEXT NOT NULL,
    slug TEXT NOT NULL,
    file_path TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'planned',
    required INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_documentation_pages_section
    ON documentation_pages(section_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_documentation_pages_category
    ON documentation_pages(category, status)`,
  `CREATE INDEX IF NOT EXISTS idx_documentation_pages_path
    ON documentation_pages(file_path)`,

  `CREATE TABLE IF NOT EXISTS help_center_surfaces (
    id TEXT PRIMARY KEY,
    surface_key TEXT NOT NULL,
    route TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    documentation_page_id TEXT REFERENCES documentation_pages(id) ON DELETE SET NULL,
    doc_href TEXT NOT NULL DEFAULT '',
    question_button_label TEXT NOT NULL DEFAULT '?',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_help_center_surfaces_key
    ON help_center_surfaces(surface_key)`,
  `CREATE INDEX IF NOT EXISTS idx_help_center_surfaces_route
    ON help_center_surfaces(route)`,
  `CREATE INDEX IF NOT EXISTS idx_help_center_surfaces_status
    ON help_center_surfaces(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS help_center_items (
    id TEXT PRIMARY KEY,
    surface_id TEXT NOT NULL REFERENCES help_center_surfaces(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    item_type TEXT NOT NULL,
    label TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    selector TEXT,
    doc_href TEXT NOT NULL DEFAULT '',
    example_value TEXT NOT NULL DEFAULT '{}',
    order_index INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_help_center_items_surface
    ON help_center_items(surface_id, item_type)`,
  `CREATE INDEX IF NOT EXISTS idx_help_center_items_key
    ON help_center_items(item_key)`,
  `CREATE INDEX IF NOT EXISTS idx_help_center_items_type
    ON help_center_items(item_type, status)`,

  `CREATE TABLE IF NOT EXISTS help_onboarding_flows (
    id TEXT PRIMARY KEY,
    flow_key TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    start_surface_key TEXT NOT NULL DEFAULT 'agent_factory',
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_help_onboarding_flows_key
    ON help_onboarding_flows(flow_key)`,
  `CREATE INDEX IF NOT EXISTS idx_help_onboarding_flows_status
    ON help_onboarding_flows(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS glossary_terms (
    id TEXT PRIMARY KEY,
    user_term TEXT NOT NULL,
    internal_term TEXT NOT NULL,
    category TEXT NOT NULL,
    definition TEXT NOT NULL DEFAULT '',
    related_entity TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_glossary_terms_user
    ON glossary_terms(user_term)`,
  `CREATE INDEX IF NOT EXISTS idx_glossary_terms_internal
    ON glossary_terms(internal_term)`,
  `CREATE INDEX IF NOT EXISTS idx_glossary_terms_category
    ON glossary_terms(category, status)`,

  `CREATE TABLE IF NOT EXISTS faq_entries (
    id TEXT PRIMARY KEY,
    question_key TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL,
    related_feature TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_faq_entries_key
    ON faq_entries(question_key)`,
  `CREATE INDEX IF NOT EXISTS idx_faq_entries_category
    ON faq_entries(category, status)`,

  `CREATE TABLE IF NOT EXISTS troubleshooting_entries (
    id TEXT PRIMARY KEY,
    symptom TEXT NOT NULL,
    cause TEXT NOT NULL,
    solution TEXT NOT NULL,
    category TEXT NOT NULL,
    related_feature TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_troubleshooting_entries_symptom
    ON troubleshooting_entries(symptom)`,
  `CREATE INDEX IF NOT EXISTS idx_troubleshooting_entries_category
    ON troubleshooting_entries(category, status)`,

  `CREATE TABLE IF NOT EXISTS quick_reference_items (
    id TEXT PRIMARY KEY,
    action_label TEXT NOT NULL,
    shortcut TEXT,
    sequence_steps TEXT NOT NULL DEFAULT '[]',
    category TEXT NOT NULL,
    target_surface TEXT NOT NULL DEFAULT 'app',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quick_reference_items_action
    ON quick_reference_items(action_label)`,
  `CREATE INDEX IF NOT EXISTS idx_quick_reference_items_category
    ON quick_reference_items(category, status)`,

  `CREATE TABLE IF NOT EXISTS non_goal_policies (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    feature_key TEXT NOT NULL,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    enforcement_policy TEXT NOT NULL DEFAULT 'documented_boundary',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_non_goal_policies_scope
    ON non_goal_policies(scope, status)`,
  `CREATE INDEX IF NOT EXISTS idx_non_goal_policies_feature
    ON non_goal_policies(feature_key)`,

  `CREATE TABLE IF NOT EXISTS brand_candidates (
    id TEXT PRIMARY KEY,
    language TEXT NOT NULL,
    name TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'candidate',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_brand_candidates_language
    ON brand_candidates(language, status)`,
  `CREATE INDEX IF NOT EXISTS idx_brand_candidates_name
    ON brand_candidates(name)`,

  `CREATE TABLE IF NOT EXISTS brand_guidelines (
    id TEXT PRIMARY KEY,
    slogan TEXT NOT NULL,
    tone_keywords TEXT NOT NULL DEFAULT '[]',
    avoid_keywords TEXT NOT NULL DEFAULT '[]',
    positioning TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_brand_guidelines_status
    ON brand_guidelines(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS competitive_positioning_reports (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    competitors TEXT NOT NULL DEFAULT '[]',
    differentiators TEXT NOT NULL DEFAULT '[]',
    strategic_implications TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_competitive_positioning_status
    ON competitive_positioning_reports(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_competitive_positioning_name
    ON competitive_positioning_reports(name)`,

  `CREATE TABLE IF NOT EXISTS ecosystem_roadmap_phases (
    id TEXT PRIMARY KEY,
    phase_number INTEGER NOT NULL,
    phase_key TEXT NOT NULL,
    stage TEXT NOT NULL,
    title TEXT NOT NULL,
    initiatives TEXT NOT NULL DEFAULT '[]',
    required_assets TEXT NOT NULL DEFAULT '{}',
    community_channels TEXT NOT NULL DEFAULT '[]',
    revenue_model TEXT NOT NULL DEFAULT '',
    enterprise_readiness TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ecosystem_roadmap_phase
    ON ecosystem_roadmap_phases(phase_number, status)`,
  `CREATE INDEX IF NOT EXISTS idx_ecosystem_roadmap_stage
    ON ecosystem_roadmap_phases(stage, status)`,
  `CREATE INDEX IF NOT EXISTS idx_ecosystem_roadmap_key
    ON ecosystem_roadmap_phases(phase_key)`,

  `CREATE TABLE IF NOT EXISTS ethical_alignment_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    refuse_categories TEXT NOT NULL DEFAULT '[]',
    warn_categories TEXT NOT NULL DEFAULT '[]',
    on_refuse TEXT NOT NULL DEFAULT 'explain_why',
    user_values TEXT NOT NULL DEFAULT '{}',
    pre_task_alignment TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ethical_alignment_policies_status
    ON ethical_alignment_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ethical_alignment_policies_name
    ON ethical_alignment_policies(name)`,

  `CREATE TABLE IF NOT EXISTS ethical_alignment_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES ethical_alignment_policies(id) ON DELETE CASCADE,
    task_summary TEXT NOT NULL,
    detected_categories TEXT NOT NULL DEFAULT '[]',
    decision TEXT NOT NULL,
    reasons TEXT NOT NULL DEFAULT '[]',
    user_values_snapshot TEXT NOT NULL DEFAULT '{}',
    pre_task_alignment_snapshot TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ethical_alignment_evaluations_policy
    ON ethical_alignment_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ethical_alignment_evaluations_decision
    ON ethical_alignment_evaluations(decision, created_at)`,

  `CREATE TABLE IF NOT EXISTS legal_compliance_frameworks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    regulations TEXT NOT NULL DEFAULT '{}',
    data_residency_default TEXT NOT NULL DEFAULT 'local_only',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legal_compliance_frameworks_status
    ON legal_compliance_frameworks(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_legal_compliance_frameworks_name
    ON legal_compliance_frameworks(name)`,

  `CREATE TABLE IF NOT EXISTS legal_disclaimer_notices (
    id TEXT PRIMARY KEY,
    placement TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    requires_acknowledgement INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_legal_disclaimer_notices_placement
    ON legal_disclaimer_notices(placement, status)`,

  `CREATE TABLE IF NOT EXISTS license_compliance_checks (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    license TEXT NOT NULL,
    obligations TEXT NOT NULL DEFAULT '[]',
    restrictions TEXT NOT NULL DEFAULT '[]',
    risk_level TEXT NOT NULL,
    attribution_text TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_license_compliance_checks_license
    ON license_compliance_checks(license, risk_level)`,
  `CREATE INDEX IF NOT EXISTS idx_license_compliance_checks_source
    ON license_compliance_checks(source)`,

  `CREATE TABLE IF NOT EXISTS emotional_ux_guidelines (
    id TEXT PRIMARY KEY,
    guideline_type TEXT NOT NULL,
    scenario_key TEXT NOT NULL,
    title TEXT NOT NULL,
    message_template TEXT NOT NULL DEFAULT '',
    behavior TEXT NOT NULL DEFAULT '',
    visual_cue TEXT NOT NULL DEFAULT '',
    audio_cue TEXT NOT NULL DEFAULT '',
    anxiety_reduction TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_emotional_ux_guidelines_type
    ON emotional_ux_guidelines(guideline_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_emotional_ux_guidelines_scenario
    ON emotional_ux_guidelines(scenario_key)`,

  `CREATE TABLE IF NOT EXISTS system_bootstrap_checks (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    component TEXT NOT NULL,
    status TEXT NOT NULL,
    observed TEXT NOT NULL DEFAULT '{}',
    threshold TEXT NOT NULL DEFAULT '{}',
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_system_bootstrap_checks_run
    ON system_bootstrap_checks(run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_system_bootstrap_checks_component
    ON system_bootstrap_checks(component, status)`,
  `CREATE INDEX IF NOT EXISTS idx_system_bootstrap_checks_status
    ON system_bootstrap_checks(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS success_metric_definitions (
    id TEXT PRIMARY KEY,
    metric_key TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    target_operator TEXT NOT NULL DEFAULT 'track',
    target_value REAL,
    unit TEXT NOT NULL DEFAULT 'count',
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_success_metric_definitions_key
    ON success_metric_definitions(metric_key)`,
  `CREATE INDEX IF NOT EXISTS idx_success_metric_definitions_category
    ON success_metric_definitions(category, status)`,

  `CREATE TABLE IF NOT EXISTS success_metric_snapshots (
    id TEXT PRIMARY KEY,
    metric_definition_id TEXT NOT NULL REFERENCES success_metric_definitions(id) ON DELETE CASCADE,
    metric_key TEXT NOT NULL,
    value REAL NOT NULL,
    status TEXT NOT NULL,
    measured_at INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_success_metric_snapshots_definition
    ON success_metric_snapshots(metric_definition_id, measured_at)`,
  `CREATE INDEX IF NOT EXISTS idx_success_metric_snapshots_key
    ON success_metric_snapshots(metric_key, status)`,

  `CREATE TABLE IF NOT EXISTS readiness_checklist_items (
    id TEXT PRIMARY KEY,
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    required INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_readiness_checklist_items_key
    ON readiness_checklist_items(item_key)`,
  `CREATE INDEX IF NOT EXISTS idx_readiness_checklist_items_category
    ON readiness_checklist_items(category, status)`,

  `CREATE TABLE IF NOT EXISTS oauth_credentials (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    grant_type TEXT NOT NULL,
    access_token_secret_ref TEXT NOT NULL,
    refresh_token_secret_ref TEXT,
    expires_at INTEGER NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    acting_as TEXT NOT NULL,
    auto_refresh INTEGER NOT NULL DEFAULT 1,
    refresh_before_expiry INTEGER NOT NULL DEFAULT 300,
    allowed_operations TEXT NOT NULL DEFAULT '[]',
    requires_user_consent INTEGER NOT NULL DEFAULT 0,
    shared INTEGER NOT NULL DEFAULT 0,
    agent_profile_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_refresh_status TEXT,
    last_refresh_error TEXT,
    paused_run_id TEXT,
    reauthorization_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_credentials_provider
    ON oauth_credentials(provider, status)`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_credentials_agent
    ON oauth_credentials(agent_profile_id, shared)`,

  `CREATE TABLE IF NOT EXISTS oauth_refresh_events (
    id TEXT PRIMARY KEY,
    credential_id TEXT NOT NULL REFERENCES oauth_credentials(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    paused_run_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_refresh_events_credential
    ON oauth_refresh_events(credential_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_oauth_refresh_events_status
    ON oauth_refresh_events(status)`,

  `CREATE TABLE IF NOT EXISTS workspace_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    structure TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    file_tree TEXT NOT NULL DEFAULT '[]',
    setup_defaults TEXT NOT NULL DEFAULT '{}',
    verify_defaults TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_templates_structure
    ON workspace_templates(structure, status)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_templates_name
    ON workspace_templates(name)`,

  `CREATE TABLE IF NOT EXISTS workspace_init_runs (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT,
    employee_run_id TEXT,
    source_type TEXT NOT NULL,
    source_config TEXT NOT NULL DEFAULT '{}',
    structure TEXT,
    install_deps INTEGER NOT NULL DEFAULT 0,
    run_migrations INTEGER NOT NULL DEFAULT 0,
    seed_data TEXT,
    link_shared_modules INTEGER NOT NULL DEFAULT 0,
    run_tests INTEGER NOT NULL DEFAULT 0,
    check_types INTEGER NOT NULL DEFAULT 0,
    lint_check INTEGER NOT NULL DEFAULT 0,
    build_check INTEGER NOT NULL DEFAULT 0,
    on_setup_fail TEXT NOT NULL DEFAULT 'ask_user',
    status TEXT NOT NULL DEFAULT 'planned',
    workspace_path TEXT,
    action_plan TEXT NOT NULL DEFAULT '[]',
    verification_plan TEXT NOT NULL DEFAULT '[]',
    failure_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_init_runs_source
    ON workspace_init_runs(source_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_init_runs_agent
    ON workspace_init_runs(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_init_runs_employee
    ON workspace_init_runs(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS custom_models (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_config TEXT NOT NULL DEFAULT '{}',
    base_model TEXT,
    dataset_description TEXT,
    task_specialization TEXT NOT NULL DEFAULT '[]',
    finetuned_at INTEGER,
    performance_delta TEXT,
    max_context_window INTEGER NOT NULL,
    requires_special_prompt_format INTEGER NOT NULL DEFAULT 0,
    known_limitations TEXT NOT NULL DEFAULT '[]',
    compatible_skills TEXT NOT NULL DEFAULT '[]',
    incompatible_skills TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'available',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_custom_models_source
    ON custom_models(source_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_models_name
    ON custom_models(name)`,

  `CREATE TABLE IF NOT EXISTS finetune_dataset_exports (
    id TEXT PRIMARY KEY,
    custom_model_id TEXT REFERENCES custom_models(id) ON DELETE SET NULL,
    source_scope TEXT NOT NULL,
    source_ids TEXT NOT NULL DEFAULT '[]',
    dataset_purpose TEXT NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    destination_provider TEXT NOT NULL DEFAULT 'manual',
    include_private_data INTEGER NOT NULL DEFAULT 0,
    consent_status TEXT NOT NULL DEFAULT 'pending',
    output_manifest TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_finetune_dataset_exports_model
    ON finetune_dataset_exports(custom_model_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_finetune_dataset_exports_consent
    ON finetune_dataset_exports(consent_status, source_scope)`,

  `CREATE TABLE IF NOT EXISTS project_contexts (
    id TEXT PRIMARY KEY,
    project_name TEXT NOT NULL,
    model_profile_id TEXT,
    max_budget REAL,
    allowed_skills TEXT NOT NULL DEFAULT '[]',
    required_approval_for TEXT NOT NULL DEFAULT '[]',
    network_profile_id TEXT,
    pause_current_tasks INTEGER NOT NULL DEFAULT 1,
    isolate_memories INTEGER NOT NULL DEFAULT 1,
    checkpoint_before_switch INTEGER NOT NULL DEFAULT 1,
    switch_mode TEXT NOT NULL DEFAULT 'sequential',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_contexts_name
    ON project_contexts(project_name)`,
  `CREATE INDEX IF NOT EXISTS idx_project_contexts_status
    ON project_contexts(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS project_agent_roles (
    id TEXT PRIMARY KEY,
    project_context_id TEXT NOT NULL REFERENCES project_contexts(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    active_workflows TEXT NOT NULL DEFAULT '[]',
    contributed_artifacts TEXT NOT NULL DEFAULT '[]',
    project_specific_memories TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_agent_roles_project
    ON project_agent_roles(project_context_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_project_agent_roles_agent
    ON project_agent_roles(agent_id, project_context_id)`,

  `CREATE TABLE IF NOT EXISTS project_switch_events (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    from_project_context_id TEXT REFERENCES project_contexts(id) ON DELETE SET NULL,
    to_project_context_id TEXT NOT NULL REFERENCES project_contexts(id) ON DELETE CASCADE,
    pause_current_tasks INTEGER NOT NULL DEFAULT 1,
    isolate_memories INTEGER NOT NULL DEFAULT 1,
    checkpoint_before_switch INTEGER NOT NULL DEFAULT 1,
    mode TEXT NOT NULL DEFAULT 'sequential',
    checkpoint_id TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_switch_events_agent
    ON project_switch_events(agent_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_project_switch_events_to_project
    ON project_switch_events(to_project_context_id, status)`,

  `CREATE TABLE IF NOT EXISTS behavior_snapshots (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    schedule TEXT NOT NULL DEFAULT 'weekly',
    avg_steps_per_task REAL NOT NULL,
    avg_cost_per_task REAL NOT NULL,
    approval_request_rate REAL NOT NULL,
    typical_plan_structure TEXT NOT NULL,
    tool_preference_order TEXT NOT NULL DEFAULT '[]',
    output_verbosity REAL NOT NULL,
    max_allowed_deviation REAL NOT NULL DEFAULT 0.2,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_behavior_snapshots_agent
    ON behavior_snapshots(agent_profile_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_behavior_snapshots_created
    ON behavior_snapshots(created_at)`,

  `CREATE TABLE IF NOT EXISTS behavior_drift_analyses (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL,
    baseline_snapshot_id TEXT NOT NULL REFERENCES behavior_snapshots(id) ON DELETE CASCADE,
    current_snapshot_id TEXT NOT NULL REFERENCES behavior_snapshots(id) ON DELETE CASCADE,
    max_deviation REAL NOT NULL,
    severity TEXT NOT NULL,
    drifted_metrics TEXT NOT NULL DEFAULT '[]',
    on_significant_drift TEXT NOT NULL,
    stabilization_actions TEXT NOT NULL DEFAULT '[]',
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_behavior_drift_agent
    ON behavior_drift_analyses(agent_profile_id, severity)`,
  `CREATE INDEX IF NOT EXISTS idx_behavior_drift_snapshots
    ON behavior_drift_analyses(baseline_snapshot_id, current_snapshot_id)`,

  `CREATE TABLE IF NOT EXISTS behavior_stabilization_runs (
    id TEXT PRIMARY KEY,
    drift_analysis_id TEXT NOT NULL REFERENCES behavior_drift_analyses(id) ON DELETE CASCADE,
    agent_profile_id TEXT NOT NULL,
    actions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_behavior_stabilization_runs_analysis
    ON behavior_stabilization_runs(drift_analysis_id)`,
  `CREATE INDEX IF NOT EXISTS idx_behavior_stabilization_runs_agent
    ON behavior_stabilization_runs(agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS skill_synthesis_records (
    id TEXT PRIMARY KEY,
    source_skill_ids TEXT NOT NULL DEFAULT '[]',
    detected_pattern TEXT NOT NULL,
    suggested_composite_name TEXT NOT NULL,
    composite_description TEXT NOT NULL DEFAULT '',
    confidence REAL NOT NULL DEFAULT 0,
    publishable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'suggested',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_skill_synthesis_status
    ON skill_synthesis_records(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_skill_synthesis_name
    ON skill_synthesis_records(suggested_composite_name)`,

  `CREATE TABLE IF NOT EXISTS tool_pipelines (
    id TEXT PRIMARY KEY,
    synthesis_record_id TEXT REFERENCES skill_synthesis_records(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    composed_of TEXT NOT NULL DEFAULT '[]',
    chain TEXT NOT NULL DEFAULT '[]',
    input_output_mapping TEXT NOT NULL DEFAULT '{}',
    on_step_failure TEXT NOT NULL DEFAULT 'abort',
    publishable INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tool_pipelines_status
    ON tool_pipelines(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tool_pipelines_synthesis
    ON tool_pipelines(synthesis_record_id)`,

  `CREATE TABLE IF NOT EXISTS unified_search_index (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    snippet TEXT NOT NULL DEFAULT '',
    keywords TEXT NOT NULL DEFAULT '[]',
    embedding TEXT NOT NULL DEFAULT '[]',
    agent_name TEXT,
    task_name TEXT,
    project_name TEXT,
    timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_unified_search_entity
    ON unified_search_index(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_unified_search_timestamp
    ON unified_search_index(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_unified_search_project
    ON unified_search_index(project_name)`,

  `CREATE TABLE IF NOT EXISTS context_caches (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    project_id TEXT,
    task_type TEXT NOT NULL DEFAULT 'general',
    goal TEXT NOT NULL,
    cache_key TEXT NOT NULL,
    predictors TEXT NOT NULL DEFAULT '[]',
    preload_flags TEXT NOT NULL DEFAULT '{}',
    cached_sections TEXT NOT NULL DEFAULT '[]',
    project_structure_ttl TEXT NOT NULL DEFAULT 'until_file_change',
    semantic_cache_ttl INTEGER NOT NULL DEFAULT 300,
    memory_search_cache_ttl INTEGER NOT NULL DEFAULT 600,
    expires_at INTEGER,
    invalidation_signal TEXT,
    status TEXT NOT NULL DEFAULT 'fresh',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_caches_key
    ON context_caches(cache_key)`,
  `CREATE INDEX IF NOT EXISTS idx_context_caches_agent_project
    ON context_caches(agent_profile_id, project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_context_caches_status
    ON context_caches(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS software_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    app_type TEXT NOT NULL,
    launch_command TEXT,
    executable_path TEXT,
    default_workstation_mode TEXT NOT NULL DEFAULT 'browser_context',
    adapter_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS software_commands (
    id TEXT PRIMARY KEY,
    software_profile_id TEXT NOT NULL REFERENCES software_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    input_schema TEXT NOT NULL DEFAULT '{}',
    output_schema TEXT NOT NULL DEFAULT '{}',
    implementation TEXT NOT NULL,
    risk_level TEXT NOT NULL DEFAULT 'medium',
    requires_approval INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    last_test_result TEXT,
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_software_commands_profile ON software_commands(software_profile_id)`,

  `CREATE TABLE IF NOT EXISTS recorded_macros (
    id TEXT PRIMARY KEY,
    software_profile_id TEXT NOT NULL REFERENCES software_profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    steps TEXT NOT NULL DEFAULT '[]',
    input_schema TEXT NOT NULL DEFAULT '{}',
    output_schema TEXT NOT NULL DEFAULT '{}',
    parameter_bindings TEXT NOT NULL DEFAULT '{}',
    risk_level TEXT NOT NULL DEFAULT 'medium',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recorded_macros_profile
    ON recorded_macros(software_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_recorded_macros_status
    ON recorded_macros(status)`,

  `CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    fallback_model_profile_ids TEXT NOT NULL DEFAULT '[]',
    skill_ids TEXT NOT NULL DEFAULT '[]',
    mcp_server_ids TEXT NOT NULL DEFAULT '[]',
    cli_profile_ids TEXT NOT NULL DEFAULT '[]',
    software_profile_ids TEXT NOT NULL DEFAULT '[]',
    memory_policy TEXT NOT NULL DEFAULT '{}',
    autonomy_policy TEXT NOT NULL DEFAULT '{}',
    workstation_policy TEXT NOT NULL DEFAULT '{}',
    permission_policy TEXT NOT NULL DEFAULT '{}',
    input_contract TEXT NOT NULL DEFAULT '{}',
    output_contract TEXT NOT NULL DEFAULT '{}',
    persona TEXT NOT NULL DEFAULT '{}',
    system_prompt TEXT NOT NULL DEFAULT '',
    behavior_rules TEXT NOT NULL DEFAULT '[]',
    success_criteria TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_profiles_status ON agent_profiles(status)`,

  `CREATE TABLE IF NOT EXISTS agent_clone_records (
    id TEXT PRIMARY KEY,
    source_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    cloned_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    copied_model_config INTEGER NOT NULL DEFAULT 1,
    skill_mode TEXT NOT NULL DEFAULT 'shared',
    memory_mode TEXT NOT NULL DEFAULT 'semantic_only',
    copied_permission_config INTEGER NOT NULL DEFAULT 1,
    modifications TEXT NOT NULL DEFAULT '{}',
    experiment_note TEXT NOT NULL DEFAULT '',
    copied_memory_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'created',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_clone_records_source
    ON agent_clone_records(source_agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_clone_records_cloned
    ON agent_clone_records(cloned_agent_profile_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_comparison_reports (
    id TEXT PRIMARY KEY,
    left_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    right_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    tasks TEXT NOT NULL DEFAULT '[]',
    metrics TEXT NOT NULL DEFAULT '{}',
    task_results TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_comparison_reports_left
    ON agent_comparison_reports(left_agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_comparison_reports_right
    ON agent_comparison_reports(right_agent_profile_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_what_if_analyses (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    proposed_changes TEXT NOT NULL DEFAULT '{}',
    impact_items TEXT NOT NULL DEFAULT '[]',
    affected_workflow_ids TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_what_if_analyses_agent
    ON agent_what_if_analyses(agent_profile_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_schedules (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    weekly_schedule TEXT NOT NULL DEFAULT '{}',
    maintenance_windows TEXT NOT NULL DEFAULT '[]',
    overtime_policy TEXT NOT NULL DEFAULT '{}',
    vacation_mode TEXT NOT NULL DEFAULT '{}',
    current_status TEXT NOT NULL DEFAULT 'off_duty',
    last_decision TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_evaluated_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_schedules_agent
    ON agent_schedules(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_schedules_status
    ON agent_schedules(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS agent_certification_exams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    tasks TEXT NOT NULL DEFAULT '[]',
    passing_score REAL NOT NULL DEFAULT 80,
    validity_period TEXT NOT NULL DEFAULT '1y',
    level TEXT NOT NULL DEFAULT 'basic',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_certification_exams_status
    ON agent_certification_exams(status, level)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_certification_exams_name
    ON agent_certification_exams(name)`,

  `CREATE TABLE IF NOT EXISTS agent_certification_runs (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    exam_id TEXT NOT NULL REFERENCES agent_certification_exams(id) ON DELETE CASCADE,
    submissions TEXT NOT NULL DEFAULT '[]',
    task_scores TEXT NOT NULL DEFAULT '[]',
    score REAL NOT NULL DEFAULT 0,
    passed INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'completed',
    badge TEXT NOT NULL DEFAULT '',
    discovered_limitations TEXT NOT NULL DEFAULT '[]',
    improvement_suggestions TEXT NOT NULL DEFAULT '[]',
    completed_at INTEGER NOT NULL,
    expires_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_certification_runs_agent
    ON agent_certification_runs(agent_profile_id, completed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_certification_runs_exam
    ON agent_certification_runs(exam_id, passed)`,

  `CREATE TABLE IF NOT EXISTS style_guides (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT '{}',
    code TEXT NOT NULL DEFAULT '{}',
    visual TEXT NOT NULL DEFAULT '{}',
    output_rules TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_style_guides_status
    ON style_guides(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS agent_style_guide_bindings (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    style_guide_id TEXT NOT NULL REFERENCES style_guides(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_style_guide_bindings_agent
    ON agent_style_guide_bindings(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_style_guide_bindings_guide
    ON agent_style_guide_bindings(style_guide_id, status)`,

  `CREATE TABLE IF NOT EXISTS agent_diversity_profiles (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    personality TEXT NOT NULL DEFAULT 'cautious',
    perspective TEXT NOT NULL DEFAULT 'implementation',
    temperature REAL NOT NULL DEFAULT 0.4,
    risk_posture TEXT NOT NULL DEFAULT 'balanced',
    collaboration_role TEXT NOT NULL DEFAULT 'contributor',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_diversity_profiles_agent
    ON agent_diversity_profiles(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_diversity_profiles_personality
    ON agent_diversity_profiles(personality, status)`,

  `CREATE TABLE IF NOT EXISTS diversity_analyses (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL DEFAULT 'team',
    scope_id TEXT,
    agent_profile_ids TEXT NOT NULL DEFAULT '[]',
    model_diversity TEXT NOT NULL DEFAULT '[]',
    skill_diversity INTEGER NOT NULL DEFAULT 0,
    perspective_diversity REAL NOT NULL DEFAULT 0,
    personality_diversity REAL NOT NULL DEFAULT 0,
    missing_perspectives TEXT NOT NULL DEFAULT '[]',
    recommendation TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_diversity_analyses_scope
    ON diversity_analyses(scope_type, scope_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_interviews (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    scenario_title TEXT NOT NULL,
    scenario_task TEXT NOT NULL,
    transcript TEXT NOT NULL DEFAULT '[]',
    rubric TEXT NOT NULL DEFAULT '{}',
    scores TEXT NOT NULL DEFAULT '{}',
    overall_score REAL NOT NULL DEFAULT 0,
    strengths TEXT NOT NULL DEFAULT '[]',
    warnings TEXT NOT NULL DEFAULT '[]',
    recommendations TEXT NOT NULL DEFAULT '[]',
    prompt_patches TEXT NOT NULL DEFAULT '[]',
    trial_decision TEXT NOT NULL DEFAULT 'revise_prompt',
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_interviews_agent
    ON agent_interviews(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_interviews_status
    ON agent_interviews(status, overall_score)`,

  `CREATE TABLE IF NOT EXISTS performance_reviews (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    reviewer_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    sampled_run_ids TEXT NOT NULL DEFAULT '[]',
    period_start_at INTEGER,
    period_end_at INTEGER,
    sample_size INTEGER NOT NULL DEFAULT 3,
    quality_score REAL NOT NULL DEFAULT 0,
    reliability_score REAL NOT NULL DEFAULT 0,
    adaptation_score REAL NOT NULL DEFAULT 0,
    overall_score REAL NOT NULL DEFAULT 0,
    findings TEXT NOT NULL DEFAULT '[]',
    improvement_suggestions TEXT NOT NULL DEFAULT '[]',
    recommended_prompt_patches TEXT NOT NULL DEFAULT '[]',
    applied_changes TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_performance_reviews_agent
    ON performance_reviews(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_performance_reviews_status
    ON performance_reviews(status, overall_score)`,
  `CREATE INDEX IF NOT EXISTS idx_performance_reviews_reviewer
    ON performance_reviews(reviewer_agent_profile_id)`,

  `CREATE TABLE IF NOT EXISTS agent_mentorships (
    id TEXT PRIMARY KEY,
    mentor_agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    mentee_agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    scope TEXT NOT NULL DEFAULT 'until_proficiency',
    scope_task_types TEXT NOT NULL DEFAULT '[]',
    style TEXT NOT NULL DEFAULT 'review_and_feedback',
    review_outputs INTEGER NOT NULL DEFAULT 1,
    intervene_when_stuck INTEGER NOT NULL DEFAULT 1,
    share_relevant_memories INTEGER NOT NULL DEFAULT 1,
    generate_practice_tasks INTEGER NOT NULL DEFAULT 1,
    initial_proficiency REAL NOT NULL DEFAULT 0,
    current_proficiency REAL NOT NULL DEFAULT 0,
    target_proficiency REAL NOT NULL DEFAULT 0.8,
    tasks_until_graduation INTEGER NOT NULL DEFAULT 5,
    fastest_improving_areas TEXT NOT NULL DEFAULT '[]',
    needs_improvement TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    graduated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_mentorships_mentor
    ON agent_mentorships(mentor_agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_mentorships_mentee
    ON agent_mentorships(mentee_agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS agent_mentoring_events (
    id TEXT PRIMARY KEY,
    mentorship_id TEXT NOT NULL REFERENCES agent_mentorships(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
    summary TEXT NOT NULL DEFAULT '',
    feedback TEXT NOT NULL DEFAULT '',
    shared_memory_ids TEXT NOT NULL DEFAULT '[]',
    practice_task TEXT NOT NULL DEFAULT '{}',
    proficiency_delta REAL NOT NULL DEFAULT 0,
    successful_task INTEGER NOT NULL DEFAULT 0,
    areas_improved TEXT NOT NULL DEFAULT '[]',
    needs_improvement TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_mentoring_events_mentorship
    ON agent_mentoring_events(mentorship_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_mentoring_events_type
    ON agent_mentoring_events(event_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS user_overrides (
    id TEXT PRIMARY KEY,
    command TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'workspace',
    target_id TEXT,
    reason TEXT NOT NULL DEFAULT '',
    trigger TEXT NOT NULL DEFAULT 'api',
    payload TEXT NOT NULL DEFAULT '{}',
    effects TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'recorded',
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_overrides_target
    ON user_overrides(target_type, target_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_user_overrides_command
    ON user_overrides(command, status)`,

  `CREATE TABLE IF NOT EXISTS model_route_decisions (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    requested_capabilities TEXT NOT NULL DEFAULT '{}',
    selected_model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    fallback_model_profile_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    estimated_input_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_output_tokens INTEGER NOT NULL DEFAULT 0,
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_route_decisions_agent
    ON model_route_decisions(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_route_decisions_selected
    ON model_route_decisions(selected_model_profile_id)`,

  `CREATE TABLE IF NOT EXISTS capability_index_entries (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    capability_kind TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    signals TEXT NOT NULL DEFAULT '{}',
    risk_level TEXT NOT NULL DEFAULT 'low',
    enabled INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown',
    score_hint REAL NOT NULL DEFAULT 0,
    last_indexed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_capability_index_source
    ON capability_index_entries(source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_capability_index_kind
    ON capability_index_entries(capability_kind, enabled)`,

  `CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
    id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL,
    source_type TEXT,
    source_id TEXT,
    label TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    properties TEXT NOT NULL DEFAULT '{}',
    embedding TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_source
    ON knowledge_graph_nodes(source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type
    ON knowledge_graph_nodes(node_type)`,

  `CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
    id TEXT PRIMARY KEY,
    from_node_id TEXT NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
    to_node_id TEXT NOT NULL REFERENCES knowledge_graph_nodes(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL,
    weight REAL NOT NULL DEFAULT 1,
    evidence TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_edges_from
    ON knowledge_graph_edges(from_node_id, edge_type)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_edges_to
    ON knowledge_graph_edges(to_node_id, edge_type)`,

  `CREATE TABLE IF NOT EXISTS capability_recommendations (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    query TEXT NOT NULL,
    capability_entry_id TEXT REFERENCES capability_index_entries(id) ON DELETE SET NULL,
    score REAL NOT NULL,
    reason TEXT NOT NULL,
    applied INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_capability_recommendations_agent
    ON capability_recommendations(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_capability_recommendations_entry
    ON capability_recommendations(capability_entry_id)`,

  `CREATE TABLE IF NOT EXISTS autonomy_decisions (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    requested_mode TEXT NOT NULL DEFAULT 'dry_run',
    autonomy_level TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    status TEXT NOT NULL,
    requires_approval INTEGER NOT NULL DEFAULT 0,
    reason TEXT NOT NULL,
    policy_snapshot TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_autonomy_decisions_agent
    ON autonomy_decisions(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_autonomy_decisions_resource
    ON autonomy_decisions(resource_type, resource_id)`,

  `CREATE TABLE IF NOT EXISTS dynamic_permission_grants (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    permission_key TEXT NOT NULL,
    action_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    duration TEXT NOT NULL,
    status TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    justification TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    policy_snapshot TEXT NOT NULL DEFAULT '{}',
    autonomy_decision_id TEXT REFERENCES autonomy_decisions(id) ON DELETE SET NULL,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dynamic_permission_grants_agent
    ON dynamic_permission_grants(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamic_permission_grants_run
    ON dynamic_permission_grants(employee_run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_dynamic_permission_grants_permission
    ON dynamic_permission_grants(permission_key, status)`,

  `CREATE TABLE IF NOT EXISTS voice_interface_profiles (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    input_mode TEXT NOT NULL DEFAULT 'push_to_talk',
    wake_word TEXT,
    language TEXT NOT NULL DEFAULT 'en-US',
    speaker_identification INTEGER NOT NULL DEFAULT 0,
    tts_engine TEXT NOT NULL DEFAULT 'system',
    voice TEXT NOT NULL DEFAULT 'default',
    speed REAL NOT NULL DEFAULT 1,
    speak_on TEXT NOT NULL DEFAULT '[]',
    conversation_policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_voice_interface_profiles_agent
    ON voice_interface_profiles(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_voice_interface_profiles_status
    ON voice_interface_profiles(status)`,

  `CREATE TABLE IF NOT EXISTS voice_conversation_turns (
    id TEXT PRIMARY KEY,
    voice_interface_profile_id TEXT REFERENCES voice_interface_profiles(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    speaker TEXT NOT NULL,
    speaker_label TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en-US',
    source TEXT NOT NULL DEFAULT 'text_placeholder',
    status TEXT NOT NULL DEFAULT 'captured',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_voice_turns_profile
    ON voice_conversation_turns(voice_interface_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_voice_turns_agent
    ON voice_conversation_turns(agent_profile_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS e2e_encryption_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    local_ipc_encryption TEXT NOT NULL DEFAULT 'none',
    remote_encryption TEXT NOT NULL DEFAULT 'tls_1_3',
    certificate_pinning INTEGER NOT NULL DEFAULT 1,
    mutual_tls INTEGER NOT NULL DEFAULT 0,
    encrypt_export INTEGER NOT NULL DEFAULT 1,
    password_protected INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_e2e_policies_status
    ON e2e_encryption_policies(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS e2e_encryption_checks (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES e2e_encryption_policies(id) ON DELETE SET NULL,
    scope TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    status TEXT NOT NULL,
    findings TEXT NOT NULL DEFAULT '[]',
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_e2e_checks_policy
    ON e2e_encryption_checks(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_e2e_checks_scope_status
    ON e2e_encryption_checks(scope, status)`,

  `CREATE TABLE IF NOT EXISTS concurrency_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_processes INTEGER NOT NULL DEFAULT 64,
    max_file_descriptors INTEGER NOT NULL DEFAULT 1024,
    max_memory_bytes INTEGER NOT NULL DEFAULT 8589934592,
    max_browser_instances INTEGER NOT NULL DEFAULT 3,
    max_model_connections INTEGER NOT NULL DEFAULT 8,
    low_memory_max_agents INTEGER NOT NULL DEFAULT 2,
    low_memory_max_browsers INTEGER NOT NULL DEFAULT 1,
    mid_memory_max_agents INTEGER NOT NULL DEFAULT 5,
    mid_memory_max_browsers INTEGER NOT NULL DEFAULT 3,
    high_memory_max_agents INTEGER NOT NULL DEFAULT 10,
    high_memory_max_browsers INTEGER NOT NULL DEFAULT 6,
    workstation_max_agents INTEGER NOT NULL DEFAULT 20,
    workstation_max_browsers INTEGER NOT NULL DEFAULT 12,
    adaptive_limit INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_concurrency_profiles_status
    ON concurrency_profiles(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS concurrency_evaluations (
    id TEXT PRIMARY KEY,
    concurrency_profile_id TEXT REFERENCES concurrency_profiles(id) ON DELETE SET NULL,
    memory_tier TEXT NOT NULL,
    current_agents INTEGER NOT NULL DEFAULT 0,
    current_browsers INTEGER NOT NULL DEFAULT 0,
    current_model_connections INTEGER NOT NULL DEFAULT 0,
    total_memory_bytes INTEGER NOT NULL DEFAULT 0,
    used_memory_bytes INTEGER NOT NULL DEFAULT 0,
    recommended_max_agents INTEGER NOT NULL DEFAULT 0,
    recommended_max_browsers INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_concurrency_evaluations_profile
    ON concurrency_evaluations(concurrency_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_concurrency_evaluations_status
    ON concurrency_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS abuse_prevention_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_creation_burst_max INTEGER NOT NULL DEFAULT 10,
    agent_creation_burst_window_ms INTEGER NOT NULL DEFAULT 3600000,
    outbound_request_burst_max INTEGER NOT NULL DEFAULT 100,
    outbound_request_burst_window_ms INTEGER NOT NULL DEFAULT 60000,
    max_requests_per_domain INTEGER NOT NULL DEFAULT 30,
    spam_similar_output_ratio REAL NOT NULL DEFAULT 0.85,
    intrusion_patterns TEXT NOT NULL DEFAULT '[]',
    light_action TEXT NOT NULL DEFAULT 'warn_user',
    moderate_action TEXT NOT NULL DEFAULT 'pause_agent_and_warn',
    severe_action TEXT NOT NULL DEFAULT 'stop_and_quarantine_agent',
    critical_action TEXT NOT NULL DEFAULT 'stop_all_and_notify_admin',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_abuse_policies_status
    ON abuse_prevention_policies(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS abuse_detection_events (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES abuse_prevention_policies(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    severity TEXT NOT NULL DEFAULT 'none',
    action TEXT NOT NULL DEFAULT 'none',
    detected_rules TEXT NOT NULL DEFAULT '[]',
    signals TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_abuse_events_policy
    ON abuse_detection_events(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_abuse_events_agent
    ON abuse_detection_events(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_abuse_events_severity
    ON abuse_detection_events(severity, created_at)`,

  `CREATE TABLE IF NOT EXISTS abuse_appeals (
    id TEXT PRIMARY KEY,
    abuse_detection_event_id TEXT REFERENCES abuse_detection_events(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'submitted',
    review_note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_abuse_appeals_event
    ON abuse_appeals(abuse_detection_event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_abuse_appeals_status
    ON abuse_appeals(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS future_tech_interfaces (
    id TEXT PRIMARY KEY,
    capability_kind TEXT NOT NULL,
    display_name TEXT NOT NULL,
    abstraction_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    reserved_methods TEXT NOT NULL DEFAULT '[]',
    safety_boundary TEXT NOT NULL DEFAULT '',
    local_first INTEGER NOT NULL DEFAULT 1,
    readiness TEXT NOT NULL DEFAULT 'reserved',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_future_tech_interfaces_kind
    ON future_tech_interfaces(capability_kind)`,
  `CREATE INDEX IF NOT EXISTS idx_future_tech_interfaces_readiness
    ON future_tech_interfaces(readiness, updated_at)`,

  `CREATE TABLE IF NOT EXISTS future_tech_radar_items (
    id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    capability_kinds TEXT NOT NULL DEFAULT '[]',
    dependencies TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_future_tech_radar_stage
    ON future_tech_radar_items(stage, status)`,
  `CREATE INDEX IF NOT EXISTS idx_future_tech_radar_status
    ON future_tech_radar_items(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS commercial_plans (
    id TEXT PRIMARY KEY,
    plan_key TEXT NOT NULL,
    name TEXT NOT NULL,
    price_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'USD',
    billing_period TEXT NOT NULL,
    max_agents INTEGER,
    max_concurrent_runs INTEGER,
    features TEXT NOT NULL DEFAULT '[]',
    limits TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_commercial_plans_key
    ON commercial_plans(plan_key)`,
  `CREATE INDEX IF NOT EXISTS idx_commercial_plans_status
    ON commercial_plans(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS monetization_revenue_streams (
    id TEXT PRIMARY KEY,
    stream_type TEXT NOT NULL,
    name TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 100,
    description TEXT NOT NULL DEFAULT '',
    commission_rate_bps INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_revenue_streams_type
    ON monetization_revenue_streams(stream_type)`,
  `CREATE INDEX IF NOT EXISTS idx_revenue_streams_status
    ON monetization_revenue_streams(status, priority)`,

  `CREATE TABLE IF NOT EXISTS commercial_policy_rules (
    id TEXT PRIMARY KEY,
    rule_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'info',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_commercial_policy_rules_type
    ON commercial_policy_rules(rule_type)`,
  `CREATE INDEX IF NOT EXISTS idx_commercial_policy_rules_status
    ON commercial_policy_rules(status, severity)`,

  `CREATE TABLE IF NOT EXISTS open_source_components (
    id TEXT PRIMARY KEY,
    layer TEXT NOT NULL,
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT '',
    license TEXT NOT NULL,
    source_visibility TEXT NOT NULL DEFAULT 'source_visible',
    commercial_use TEXT NOT NULL DEFAULT 'allowed',
    author_policy TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_open_source_components_layer
    ON open_source_components(layer)`,
  `CREATE INDEX IF NOT EXISTS idx_open_source_components_status
    ON open_source_components(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS community_governance_roles (
    id TEXT PRIMARY KEY,
    role_type TEXT NOT NULL,
    name TEXT NOT NULL,
    responsibilities TEXT NOT NULL DEFAULT '[]',
    permissions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_governance_roles_type
    ON community_governance_roles(role_type)`,
  `CREATE INDEX IF NOT EXISTS idx_governance_roles_status
    ON community_governance_roles(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS governance_rfc_decisions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    proposer TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'rfc',
    discussion_url TEXT,
    votes_for INTEGER NOT NULL DEFAULT 0,
    votes_against INTEGER NOT NULL DEFAULT 0,
    implementation_notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_governance_rfc_status
    ON governance_rfc_decisions(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_governance_rfc_proposer
    ON governance_rfc_decisions(proposer, created_at)`,

  `CREATE TABLE IF NOT EXISTS contributor_prerequisites (
    id TEXT PRIMARY KEY,
    tool TEXT NOT NULL,
    minimum_version TEXT NOT NULL DEFAULT '',
    required INTEGER NOT NULL DEFAULT 1,
    install_hint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contributor_prerequisites_tool
    ON contributor_prerequisites(tool)`,
  `CREATE INDEX IF NOT EXISTS idx_contributor_prerequisites_status
    ON contributor_prerequisites(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS contribution_policies (
    id TEXT PRIMARY KEY,
    policy_type TEXT NOT NULL,
    key TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    required INTEGER NOT NULL DEFAULT 1,
    metadata TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contribution_policies_type
    ON contribution_policies(policy_type)`,
  `CREATE INDEX IF NOT EXISTS idx_contribution_policies_status
    ON contribution_policies(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS architecture_patterns (
    id TEXT PRIMARY KEY,
    pattern_key TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    applied_to TEXT NOT NULL DEFAULT '[]',
    required INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_architecture_patterns_key
    ON architecture_patterns(pattern_key)`,
  `CREATE INDEX IF NOT EXISTS idx_architecture_patterns_status
    ON architecture_patterns(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS architecture_interfaces (
    id TEXT PRIMARY KEY,
    interface_name TEXT NOT NULL,
    responsibility TEXT NOT NULL DEFAULT '',
    reserved_methods TEXT NOT NULL DEFAULT '[]',
    owner_service TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_architecture_interfaces_name
    ON architecture_interfaces(interface_name)`,
  `CREATE INDEX IF NOT EXISTS idx_architecture_interfaces_status
    ON architecture_interfaces(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS technical_architecture_evaluations (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    status TEXT NOT NULL,
    manifest TEXT NOT NULL DEFAULT '{}',
    checks TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_technical_architecture_evaluations_status
    ON technical_architecture_evaluations(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_technical_architecture_evaluations_version
    ON technical_architecture_evaluations(version, created_at)`,

  `CREATE TABLE IF NOT EXISTS error_code_catalog (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL,
    category TEXT NOT NULL,
    numeric_code TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'error',
    retryable INTEGER NOT NULL DEFAULT 0,
    remediation TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_error_code_catalog_code
    ON error_code_catalog(code)`,
  `CREATE INDEX IF NOT EXISTS idx_error_code_catalog_category
    ON error_code_catalog(category, numeric_code)`,
  `CREATE INDEX IF NOT EXISTS idx_error_code_catalog_status
    ON error_code_catalog(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS entity_state_machines (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    states TEXT NOT NULL DEFAULT '[]',
    initial_state TEXT NOT NULL,
    terminal_states TEXT NOT NULL DEFAULT '[]',
    error_state TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_state_machines_type
    ON entity_state_machines(entity_type)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_state_machines_status
    ON entity_state_machines(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS entity_state_transitions (
    id TEXT PRIMARY KEY,
    machine_id TEXT NOT NULL REFERENCES entity_state_machines(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    trigger TEXT NOT NULL DEFAULT '',
    reversible INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_state_transitions_unique
    ON entity_state_transitions(entity_type, from_state, to_state, trigger)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_state_transitions_machine
    ON entity_state_transitions(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_state_transitions_entity_from
    ON entity_state_transitions(entity_type, from_state)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_state_transitions_status
    ON entity_state_transitions(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS prompt_engineering_guides (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    recommended_sections TEXT NOT NULL DEFAULT '[]',
    required_placeholders TEXT NOT NULL DEFAULT '[]',
    max_tokens INTEGER NOT NULL DEFAULT 3000,
    example_policy TEXT NOT NULL DEFAULT 'specific_examples_with_positive_negative_pairs',
    must_rule_phrase TEXT NOT NULL DEFAULT '你必须',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_engineering_guides_status
    ON prompt_engineering_guides(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_engineering_guides_name
    ON prompt_engineering_guides(name)`,

  `CREATE TABLE IF NOT EXISTS prompt_anti_pattern_rules (
    id TEXT PRIMARY KEY,
    guide_id TEXT NOT NULL REFERENCES prompt_engineering_guides(id) ON DELETE CASCADE,
    rule_key TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity TEXT NOT NULL DEFAULT 'medium',
    detector_hint TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_anti_pattern_rules_guide
    ON prompt_anti_pattern_rules(guide_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_anti_pattern_rules_key
    ON prompt_anti_pattern_rules(rule_key, status)`,

  `CREATE TABLE IF NOT EXISTS prompt_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'workspace',
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    engine TEXT NOT NULL DEFAULT 'handlebars',
    template TEXT NOT NULL DEFAULT '',
    variables TEXT NOT NULL DEFAULT '{}',
    conditional_blocks TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_templates_scope_status
    ON prompt_templates(scope, status)`,

  `CREATE TABLE IF NOT EXISTS prompt_template_versions (
    id TEXT PRIMARY KEY,
    prompt_template_id TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    system_prompt TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    context_rules TEXT NOT NULL DEFAULT '[]',
    input_schema TEXT NOT NULL DEFAULT '{}',
    output_schema TEXT NOT NULL DEFAULT '{}',
    model_hints TEXT NOT NULL DEFAULT '{}',
    ab_test TEXT,
    deployed_at INTEGER,
    retired_at INTEGER,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_template_versions_template
    ON prompt_template_versions(prompt_template_id, version)`,

  `CREATE TABLE IF NOT EXISTS context_compressor_policies (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    token_budget_config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_compressor_policies_agent
    ON context_compressor_policies(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_context_compressor_policies_status
    ON context_compressor_policies(status)`,

  `CREATE TABLE IF NOT EXISTS prompt_drift_monitors (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL DEFAULT '30d',
    checks TEXT NOT NULL,
    on_drift_detected TEXT NOT NULL DEFAULT 'notify_user',
    thresholds TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    last_run_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_drift_monitors_agent
    ON prompt_drift_monitors(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_drift_monitors_model
    ON prompt_drift_monitors(model_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_drift_monitors_schedule
    ON prompt_drift_monitors(schedule, status)`,

  `CREATE TABLE IF NOT EXISTS model_behavior_snapshots (
    id TEXT PRIMARY KEY,
    monitor_id TEXT REFERENCES prompt_drift_monitors(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    model_name TEXT NOT NULL,
    model_date TEXT NOT NULL,
    provider_version TEXT,
    benchmark_results TEXT NOT NULL DEFAULT '{}',
    pinned INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_behavior_snapshots_monitor
    ON model_behavior_snapshots(monitor_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_behavior_snapshots_model
    ON model_behavior_snapshots(model_name, model_date)`,
  `CREATE INDEX IF NOT EXISTS idx_model_behavior_snapshots_pinned
    ON model_behavior_snapshots(pinned, created_at)`,

  `CREATE TABLE IF NOT EXISTS prompt_drift_runs (
    id TEXT PRIMARY KEY,
    monitor_id TEXT NOT NULL REFERENCES prompt_drift_monitors(id) ON DELETE CASCADE,
    baseline_snapshot_id TEXT REFERENCES model_behavior_snapshots(id) ON DELETE SET NULL,
    candidate_snapshot_id TEXT REFERENCES model_behavior_snapshots(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    drift_signals TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL,
    recommended_action TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_drift_runs_monitor
    ON prompt_drift_runs(monitor_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_prompt_drift_runs_status
    ON prompt_drift_runs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS dual_model_verifications (
    id TEXT PRIMARY KEY,
    applies_to TEXT NOT NULL,
    primary_model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    secondary_model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    secondary_model TEXT NOT NULL,
    primary_result TEXT NOT NULL DEFAULT '{}',
    secondary_result TEXT NOT NULL DEFAULT '{}',
    agreement INTEGER NOT NULL,
    disagreement_points TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL,
    recommended_action TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dual_model_verifications_task
    ON dual_model_verifications(applies_to, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_dual_model_verifications_action
    ON dual_model_verifications(recommended_action, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_consensus_votes (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    voters TEXT NOT NULL DEFAULT '[]',
    quorum INTEGER NOT NULL,
    required_majority REAL NOT NULL,
    tie_breaker TEXT NOT NULL,
    winning_vote TEXT,
    majority_ratio REAL NOT NULL DEFAULT 0,
    decision TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_consensus_votes_decision
    ON agent_consensus_votes(decision, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_consensus_votes_question
    ON agent_consensus_votes(question)`,

  `CREATE TABLE IF NOT EXISTS adversarial_reviews (
    id TEXT PRIMARY KEY,
    subject_agent_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    reviewer_agent_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    target_title TEXT NOT NULL,
    target_content TEXT NOT NULL DEFAULT '{}',
    skepticism REAL NOT NULL DEFAULT 0.8,
    assumptions TEXT NOT NULL DEFAULT '[]',
    missed_cases TEXT NOT NULL DEFAULT '[]',
    attacker_exploitation TEXT NOT NULL DEFAULT '[]',
    worst_cases TEXT NOT NULL DEFAULT '[]',
    issues TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    recommended_action TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_adversarial_reviews_subject
    ON adversarial_reviews(subject_agent_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_adversarial_reviews_reviewer
    ON adversarial_reviews(reviewer_agent_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_adversarial_reviews_status
    ON adversarial_reviews(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS content_safety_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    layers TEXT NOT NULL,
    on_flag TEXT NOT NULL DEFAULT 'warn',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_content_safety_policies_status
    ON content_safety_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_content_safety_policies_action
    ON content_safety_policies(on_flag, status)`,

  `CREATE TABLE IF NOT EXISTS content_safety_scans (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES content_safety_policies(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT,
    artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
    content_type TEXT NOT NULL DEFAULT 'text',
    content_hash TEXT NOT NULL,
    input_preview TEXT NOT NULL DEFAULT '',
    redacted_preview TEXT NOT NULL DEFAULT '',
    categories TEXT NOT NULL DEFAULT '[]',
    findings TEXT NOT NULL DEFAULT '[]',
    cloud_review_required INTEGER NOT NULL DEFAULT 0,
    decision TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_content_safety_scans_policy
    ON content_safety_scans(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_content_safety_scans_agent
    ON content_safety_scans(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_content_safety_scans_status
    ON content_safety_scans(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS copyright_checks (
    id TEXT PRIMARY KEY,
    scan_id TEXT REFERENCES content_safety_scans(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
    content_type TEXT NOT NULL DEFAULT 'code',
    config TEXT NOT NULL,
    similarity_score REAL NOT NULL DEFAULT 0,
    matched_source_refs TEXT NOT NULL DEFAULT '[]',
    metadata_flags TEXT NOT NULL DEFAULT '[]',
    external_search_required INTEGER NOT NULL DEFAULT 0,
    decision TEXT NOT NULL DEFAULT 'allow',
    status TEXT NOT NULL DEFAULT 'clear',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_copyright_checks_scan
    ON copyright_checks(scan_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_copyright_checks_agent
    ON copyright_checks(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_copyright_checks_status
    ON copyright_checks(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS trust_calibration_policies (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    trust_path TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_calibration_policies_agent
    ON trust_calibration_policies(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_trust_calibration_policies_status
    ON trust_calibration_policies(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS trust_calibration_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES trust_calibration_policies(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    metrics TEXT NOT NULL,
    current_trust_level TEXT NOT NULL,
    recommended_trust_level TEXT NOT NULL,
    current_autonomy_level TEXT NOT NULL,
    recommended_autonomy_level TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    signals TEXT NOT NULL DEFAULT '[]',
    reasons TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_trust_calibration_evaluations_policy
    ON trust_calibration_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_trust_calibration_evaluations_agent
    ON trust_calibration_evaluations(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_trust_calibration_evaluations_recommendation
    ON trust_calibration_evaluations(recommendation, created_at)`,

  `CREATE TABLE IF NOT EXISTS budget_policies (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    project_id TEXT,
    name TEXT NOT NULL,
    scope TEXT NOT NULL,
    limit_type TEXT NOT NULL,
    limit_value REAL NOT NULL,
    hard_cap INTEGER NOT NULL DEFAULT 1,
    notify_at_percent REAL NOT NULL DEFAULT 80,
    config TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_budget_policies_scope
    ON budget_policies(scope, status)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_policies_agent
    ON budget_policies(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_policies_project
    ON budget_policies(project_id, status)`,

  `CREATE TABLE IF NOT EXISTS budget_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES budget_policies(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT,
    project_id TEXT,
    scope TEXT NOT NULL,
    status TEXT NOT NULL,
    action TEXT NOT NULL,
    usage_snapshot TEXT NOT NULL,
    cost_breakdown TEXT NOT NULL,
    selected_model_profile_id TEXT,
    routed_model_profile_id TEXT,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_budget_evaluations_policy
    ON budget_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_evaluations_agent
    ON budget_evaluations(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_evaluations_status
    ON budget_evaluations(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_evaluations_project
    ON budget_evaluations(project_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS config_versions (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    display_name TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    snapshot TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL,
    change_summary TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_config_versions_entity
    ON config_versions(entity_type, entity_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_config_versions_hash
    ON config_versions(content_hash)`,

  `CREATE TABLE IF NOT EXISTS config_exports (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'gitops_bundle',
    entity_refs TEXT NOT NULL DEFAULT '[]',
    bundle TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_config_exports_created
    ON config_exports(created_at)`,

  `CREATE TABLE IF NOT EXISTS config_impact_analyses (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    base_version_id TEXT REFERENCES config_versions(id) ON DELETE SET NULL,
    proposed_hash TEXT NOT NULL,
    impact_level TEXT NOT NULL,
    summary TEXT NOT NULL,
    impacted_refs TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_config_impact_entity
    ON config_impact_analyses(entity_type, entity_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_config_impact_base
    ON config_impact_analyses(base_version_id)`,

  `CREATE TABLE IF NOT EXISTS optimistic_locks (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    entity_version INTEGER NOT NULL DEFAULT 1,
    snapshot TEXT NOT NULL DEFAULT '{}',
    content_hash TEXT NOT NULL,
    updated_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_optimistic_locks_entity
    ON optimistic_locks(entity_type, entity_id)`,

  `CREATE TABLE IF NOT EXISTS edit_conflicts (
    id TEXT PRIMARY KEY,
    lock_id TEXT REFERENCES optimistic_locks(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    your_version INTEGER NOT NULL,
    server_version INTEGER NOT NULL,
    conflicting_fields TEXT NOT NULL DEFAULT '[]',
    your_snapshot TEXT NOT NULL DEFAULT '{}',
    server_snapshot TEXT NOT NULL DEFAULT '{}',
    merged_snapshot TEXT,
    resolution TEXT NOT NULL DEFAULT 'show_diff',
    status TEXT NOT NULL DEFAULT 'open',
    resolved_by TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_edit_conflicts_entity
    ON edit_conflicts(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_edit_conflicts_status
    ON edit_conflicts(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS export_packages (
    id TEXT PRIMARY KEY,
    package_type TEXT NOT NULL,
    source_entity_type TEXT NOT NULL,
    source_entity_id TEXT NOT NULL,
    source_config_version_id TEXT REFERENCES config_versions(id) ON DELETE SET NULL,
    format_version TEXT NOT NULL DEFAULT '1.0',
    name TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT 'local-user',
    description TEXT NOT NULL DEFAULT '',
    package_version TEXT NOT NULL DEFAULT '1.0.0',
    tags TEXT NOT NULL DEFAULT '[]',
    includes TEXT NOT NULL DEFAULT '{}',
    dependencies TEXT NOT NULL DEFAULT '{}',
    payload TEXT NOT NULL DEFAULT '{}',
    file_name TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    signature TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_export_packages_type
    ON export_packages(package_type, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_export_packages_source
    ON export_packages(source_entity_type, source_entity_id)`,

  `CREATE TABLE IF NOT EXISTS package_import_checks (
    id TEXT PRIMARY KEY,
    export_package_id TEXT REFERENCES export_packages(id) ON DELETE CASCADE,
    source_file_name TEXT NOT NULL,
    compatibility_status TEXT NOT NULL DEFAULT 'compatible',
    missing_skills TEXT NOT NULL DEFAULT '[]',
    missing_models TEXT NOT NULL DEFAULT '[]',
    missing_software TEXT NOT NULL DEFAULT '[]',
    sanitized_secrets INTEGER NOT NULL DEFAULT 1,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_package_import_checks_package
    ON package_import_checks(export_package_id)`,
  `CREATE INDEX IF NOT EXISTS idx_package_import_checks_status
    ON package_import_checks(compatibility_status, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_health_scores (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    run_count INTEGER NOT NULL DEFAULT 0,
    success_rate REAL NOT NULL DEFAULT 0,
    failure_rate REAL NOT NULL DEFAULT 0,
    approval_rate REAL NOT NULL DEFAULT 0,
    self_recovery_rate REAL NOT NULL DEFAULT 0,
    score REAL NOT NULL DEFAULT 0,
    computed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_health_scores_agent
    ON agent_health_scores(agent_profile_id, computed_at)`,

  `CREATE TABLE IF NOT EXISTS agent_reputation_reviews (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    user_rating INTEGER NOT NULL,
    auto_score REAL NOT NULL DEFAULT 0,
    comment TEXT,
    reviewer TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_reputation_reviews_agent
    ON agent_reputation_reviews(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_reputation_reviews_run
    ON agent_reputation_reviews(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS agent_reputation_snapshots (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    month_label TEXT NOT NULL,
    overall_score REAL NOT NULL DEFAULT 0,
    reliability_score REAL NOT NULL DEFAULT 0,
    efficiency_score REAL NOT NULL DEFAULT 0,
    quality_score REAL NOT NULL DEFAULT 0,
    safety_score REAL NOT NULL DEFAULT 0,
    learning_score REAL NOT NULL DEFAULT 0,
    collaboration_score REAL NOT NULL DEFAULT 0,
    trend TEXT NOT NULL DEFAULT 'stable',
    recent_reviews TEXT NOT NULL DEFAULT '[]',
    badges TEXT NOT NULL DEFAULT '[]',
    run_count INTEGER NOT NULL DEFAULT 0,
    completed_run_count INTEGER NOT NULL DEFAULT 0,
    failed_run_count INTEGER NOT NULL DEFAULT 0,
    average_cost_cents REAL NOT NULL DEFAULT 0,
    average_duration_ms REAL NOT NULL DEFAULT 0,
    computed_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_reputation_snapshots_agent
    ON agent_reputation_snapshots(agent_profile_id, computed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_reputation_snapshots_month_score
    ON agent_reputation_snapshots(month_label, overall_score)`,

  `CREATE TABLE IF NOT EXISTS programmatic_api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    scopes TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_programmatic_api_keys_status
    ON programmatic_api_keys(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_programmatic_api_keys_prefix
    ON programmatic_api_keys(key_prefix)`,

  `CREATE TABLE IF NOT EXISTS sdk_tasks (
    id TEXT PRIMARY KEY,
    api_key_id TEXT REFERENCES programmatic_api_keys(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    agent_name TEXT NOT NULL,
    description TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 0,
    max_budget_cents INTEGER,
    webhook_url TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdk_tasks_run
    ON sdk_tasks(employee_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sdk_tasks_agent_status
    ON sdk_tasks(agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '[]',
    secret TEXT NOT NULL,
    filter TEXT NOT NULL DEFAULT '{}',
    max_retries INTEGER NOT NULL DEFAULT 3,
    backoff_ms INTEGER NOT NULL DEFAULT 30000,
    delivery_mode TEXT NOT NULL DEFAULT 'record_only',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_status
    ON webhook_subscriptions(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id TEXT PRIMARY KEY,
    webhook_subscription_id TEXT REFERENCES webhook_subscriptions(id) ON DELETE SET NULL,
    sdk_task_id TEXT REFERENCES sdk_tasks(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    url TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    signature TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    attempt INTEGER NOT NULL DEFAULT 0,
    next_retry_at INTEGER,
    error TEXT,
    created_at INTEGER NOT NULL,
    delivered_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_subscription
    ON webhook_deliveries(webhook_subscription_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_task
    ON webhook_deliveries(sdk_task_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
    ON webhook_deliveries(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS secret_vault (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'env_ref',
    value_ref TEXT NOT NULL,
    nonce TEXT,
    redacted_preview TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_secret_vault_status ON secret_vault(status)`,

  `CREATE TABLE IF NOT EXISTS credential_scopes (
    id TEXT PRIMARY KEY,
    secret_id TEXT NOT NULL REFERENCES secret_vault(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    capability TEXT NOT NULL DEFAULT 'use',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_credential_scopes_resource
    ON credential_scopes(resource_type, resource_id)`,

  `CREATE TABLE IF NOT EXISTS sandbox_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'strict',
    allowed_paths TEXT NOT NULL DEFAULT '[]',
    denied_paths TEXT NOT NULL DEFAULT '[]',
    allowed_commands TEXT NOT NULL DEFAULT '[]',
    network_mode TEXT NOT NULL DEFAULT 'model_only',
    requires_approval_for_writes INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sandbox_policies_level ON sandbox_policies(level)`,

  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    status TEXT NOT NULL DEFAULT 'allowed',
    risk_level TEXT NOT NULL DEFAULT 'low',
    message TEXT NOT NULL DEFAULT '',
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_created
    ON audit_logs(resource_type, resource_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created
    ON audit_logs(actor_type, actor_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS security_findings (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    action TEXT NOT NULL DEFAULT 'log',
    message TEXT NOT NULL,
    evidence TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_security_findings_source
    ON security_findings(source_type, source_id)`,
  `CREATE INDEX IF NOT EXISTS idx_security_findings_severity
    ON security_findings(severity)`,

  `CREATE TABLE IF NOT EXISTS metric_points (
    id TEXT PRIMARY KEY,
    metric_name TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    value REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT 'count',
    tags TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_metric_points_name_created
    ON metric_points(metric_name, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_metric_points_resource
    ON metric_points(resource_type, resource_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS external_monitoring_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    metrics_endpoint TEXT NOT NULL DEFAULT '/metrics',
    health_endpoint TEXT NOT NULL DEFAULT '/health',
    ready_endpoint TEXT NOT NULL DEFAULT '/ready',
    log_export TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_external_monitoring_configs_status
    ON external_monitoring_configs(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_external_monitoring_configs_name
    ON external_monitoring_configs(name)`,

  `CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    comparison TEXT NOT NULL DEFAULT 'gte',
    threshold REAL NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    enabled INTEGER NOT NULL DEFAULT 1,
    cooldown_ms INTEGER NOT NULL DEFAULT 300000,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alert_rules_metric_enabled
    ON alert_rules(metric_name, enabled)`,

  `CREATE TABLE IF NOT EXISTS alert_events (
    id TEXT PRIMARY KEY,
    alert_rule_id TEXT REFERENCES alert_rules(id) ON DELETE SET NULL,
    metric_point_id TEXT REFERENCES metric_points(id) ON DELETE SET NULL,
    resource_type TEXT,
    resource_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    severity TEXT NOT NULL DEFAULT 'warning',
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alert_events_status
    ON alert_events(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_alert_events_resource
    ON alert_events(resource_type, resource_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS debug_replay_snapshots (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    event_count INTEGER NOT NULL DEFAULT 0,
    checkpoint_id TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_debug_replay_resource
    ON debug_replay_snapshots(resource_type, resource_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL DEFAULT 'in_app',
    level TEXT NOT NULL DEFAULT 'info',
    source_type TEXT NOT NULL,
    source_id TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'unread',
    created_at INTEGER NOT NULL,
    read_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_status_created
    ON notifications(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_source
    ON notifications(source_type, source_id)`,

  `CREATE TABLE IF NOT EXISTS notification_preferences (
    id TEXT PRIMARY KEY,
    channel TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    min_level TEXT NOT NULL DEFAULT 'info',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notification_preferences_channel
    ON notification_preferences(channel)`,

  `CREATE TABLE IF NOT EXISTS retention_policies (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    retention_period TEXT NOT NULL,
    on_expiry TEXT NOT NULL DEFAULT 'ask_user',
    max_storage_bytes INTEGER,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_retention_policies_entity
    ON retention_policies(entity)`,

  `CREATE TABLE IF NOT EXISTS storage_quota_snapshots (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT,
    max_total_bytes INTEGER NOT NULL,
    current_bytes INTEGER NOT NULL,
    breakdown TEXT NOT NULL DEFAULT '{}',
    warn_at_percent REAL NOT NULL DEFAULT 80,
    block_at_percent REAL NOT NULL DEFAULT 95,
    status TEXT NOT NULL DEFAULT 'ok',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_storage_quota_scope
    ON storage_quota_snapshots(scope, scope_id)`,

  `CREATE TABLE IF NOT EXISTS data_maintenance_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_data_maintenance_policies_status
    ON data_maintenance_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_data_maintenance_policies_name
    ON data_maintenance_policies(name)`,

  `CREATE TABLE IF NOT EXISTS data_maintenance_runs (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES data_maintenance_policies(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'completed',
    log_rotation_result TEXT NOT NULL DEFAULT '{}',
    sqlite_maintenance_result TEXT NOT NULL DEFAULT '{}',
    workspace_gc_result TEXT NOT NULL DEFAULT '{}',
    browser_profile_result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_data_maintenance_runs_policy
    ON data_maintenance_runs(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_data_maintenance_runs_status
    ON data_maintenance_runs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS memory_integrity_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_integrity_policies_status
    ON memory_integrity_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_integrity_policies_name
    ON memory_integrity_policies(name)`,

  `CREATE TABLE IF NOT EXISTS memory_integrity_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES memory_integrity_policies(id) ON DELETE SET NULL,
    memory_item_id TEXT REFERENCES memory_items(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    source_type TEXT NOT NULL,
    decision TEXT NOT NULL,
    confidence_applied REAL NOT NULL DEFAULT 0,
    matched_patterns TEXT NOT NULL DEFAULT '[]',
    contradictions TEXT NOT NULL DEFAULT '[]',
    input TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_integrity_evaluations_policy
    ON memory_integrity_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_integrity_evaluations_memory
    ON memory_integrity_evaluations(memory_item_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_integrity_evaluations_decision
    ON memory_integrity_evaluations(decision, created_at)`,

  `CREATE TABLE IF NOT EXISTS nfr_requirements (
    id TEXT PRIMARY KEY,
    requirement_key TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    target TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    operator TEXT NOT NULL,
    target_value TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    evidence_refs TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nfr_requirements_key
    ON nfr_requirements(requirement_key)`,
  `CREATE INDEX IF NOT EXISTS idx_nfr_requirements_category
    ON nfr_requirements(category, status)`,

  `CREATE TABLE IF NOT EXISTS nfr_evaluations (
    id TEXT PRIMARY KEY,
    requirement_id TEXT NOT NULL REFERENCES nfr_requirements(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    observed_value TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nfr_evaluations_requirement
    ON nfr_evaluations(requirement_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_nfr_evaluations_status
    ON nfr_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS known_limitations (
    id TEXT PRIMARY KEY,
    limitation_key TEXT NOT NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'warning',
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    user_impact TEXT NOT NULL,
    workaround TEXT NOT NULL,
    roadmap TEXT NOT NULL,
    capability_tags TEXT NOT NULL DEFAULT '[]',
    disclosure_surfaces TEXT NOT NULL DEFAULT '[]',
    requires_acknowledgement INTEGER NOT NULL DEFAULT 0,
    evidence_refs TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_known_limitations_key
    ON known_limitations(limitation_key)`,
  `CREATE INDEX IF NOT EXISTS idx_known_limitations_category
    ON known_limitations(category, status)`,
  `CREATE INDEX IF NOT EXISTS idx_known_limitations_severity
    ON known_limitations(severity, status)`,

  `CREATE TABLE IF NOT EXISTS limitation_acknowledgements (
    id TEXT PRIMARY KEY,
    limitation_id TEXT NOT NULL REFERENCES known_limitations(id) ON DELETE CASCADE,
    acknowledged_by TEXT NOT NULL,
    surface TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_limitation_acknowledgements_limitation
    ON limitation_acknowledgements(limitation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_limitation_acknowledgements_user
    ON limitation_acknowledgements(acknowledged_by, created_at)`,

  `CREATE TABLE IF NOT EXISTS pii_markers (
    id TEXT PRIMARY KEY,
    memory_item_id TEXT REFERENCES memory_items(id) ON DELETE CASCADE,
    pii_type TEXT NOT NULL,
    detected_by TEXT NOT NULL DEFAULT 'regex',
    location TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'flagged',
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pii_markers_memory
    ON pii_markers(memory_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pii_markers_status
    ON pii_markers(status)`,

  `CREATE TABLE IF NOT EXISTS data_export_manifests (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    scope_id TEXT,
    format TEXT NOT NULL DEFAULT 'zip_manifest',
    include_secrets INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ready',
    manifest TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_data_export_manifests_scope
    ON data_export_manifests(scope, scope_id)`,

  `CREATE TABLE IF NOT EXISTS feature_flags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'development',
    rollout_percent REAL NOT NULL DEFAULT 0,
    target_users TEXT NOT NULL DEFAULT 'internal',
    target_user_ids TEXT NOT NULL DEFAULT '[]',
    requires_flags TEXT NOT NULL DEFAULT '[]',
    conflicts_with TEXT NOT NULL DEFAULT '[]',
    remote_override INTEGER NOT NULL DEFAULT 1,
    remote_disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feature_flags_status
    ON feature_flags(status)`,
  `CREATE INDEX IF NOT EXISTS idx_feature_flags_name
    ON feature_flags(name)`,

  `CREATE TABLE IF NOT EXISTS feature_flag_evaluations (
    id TEXT PRIMARY KEY,
    feature_flag_id TEXT NOT NULL REFERENCES feature_flags(id) ON DELETE CASCADE,
    user_id TEXT,
    groups TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    bucket REAL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feature_flag_evaluations_flag
    ON feature_flag_evaluations(feature_flag_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS degradation_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    trigger TEXT NOT NULL DEFAULT 'offline',
    action TEXT NOT NULL,
    fallback_resource_ids TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_degradation_policies_resource
    ON degradation_policies(resource_type, resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_degradation_policies_trigger
    ON degradation_policies(trigger)`,

  `CREATE TABLE IF NOT EXISTS degradation_events (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES degradation_policies(id) ON DELETE SET NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    trigger TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT NOT NULL,
    fallback_resource_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_degradation_events_resource
    ON degradation_events(resource_type, resource_id)`,
  `CREATE INDEX IF NOT EXISTS idx_degradation_events_created
    ON degradation_events(created_at)`,

  `CREATE TABLE IF NOT EXISTS update_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'Default update policy',
    check_interval TEXT NOT NULL DEFAULT 'daily',
    channel TEXT NOT NULL DEFAULT 'stable',
    auto_download INTEGER NOT NULL DEFAULT 1,
    install_on TEXT NOT NULL DEFAULT 'ask_user',
    if_agents_running TEXT NOT NULL DEFAULT 'notify_user',
    max_wait_ms INTEGER NOT NULL DEFAULT 7200000,
    rollback_crash_on_startup INTEGER NOT NULL DEFAULT 1,
    rollback_agent_success_rate_drop REAL NOT NULL DEFAULT 20,
    last_checked_at INTEGER,
    last_check_result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_update_policies_channel
    ON update_policies(channel, check_interval)`,
  `CREATE INDEX IF NOT EXISTS idx_update_policies_updated
    ON update_policies(updated_at)`,

  `CREATE TABLE IF NOT EXISTS maintenance_windows (
    id TEXT PRIMARY KEY,
    update_policy_id TEXT REFERENCES update_policies(id) ON DELETE SET NULL,
    reason TEXT NOT NULL DEFAULT 'Scheduled maintenance',
    status TEXT NOT NULL DEFAULT 'active',
    blocked_new_tasks INTEGER NOT NULL DEFAULT 1,
    running_agent_count INTEGER NOT NULL DEFAULT 0,
    queued_agent_count INTEGER NOT NULL DEFAULT 0,
    db_maintenance_result TEXT NOT NULL DEFAULT '{}',
    temp_cleanup_result TEXT NOT NULL DEFAULT '{}',
    integrity_check_result TEXT NOT NULL DEFAULT '{}',
    service_restart_result TEXT NOT NULL DEFAULT '{}',
    notification_id TEXT REFERENCES notifications(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    started_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_maintenance_windows_status
    ON maintenance_windows(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_maintenance_windows_policy
    ON maintenance_windows(update_policy_id)`,

  `CREATE TABLE IF NOT EXISTS custom_metric_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'workspace',
    scope_id TEXT,
    optimization_target TEXT NOT NULL DEFAULT 'balanced',
    weights TEXT NOT NULL DEFAULT '{}',
    constraints TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_custom_metric_profiles_scope
    ON custom_metric_profiles(scope, scope_id)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_metric_profiles_target
    ON custom_metric_profiles(optimization_target)`,

  `CREATE TABLE IF NOT EXISTS custom_metric_evaluations (
    id TEXT PRIMARY KEY,
    custom_metric_profile_id TEXT NOT NULL REFERENCES custom_metric_profiles(id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL DEFAULT 'task_estimate',
    resource_id TEXT,
    estimated_cost_cents REAL NOT NULL DEFAULT 0,
    estimated_duration_ms REAL NOT NULL DEFAULT 0,
    quality_score REAL NOT NULL DEFAULT 0,
    action_types TEXT NOT NULL DEFAULT '[]',
    score REAL NOT NULL,
    status TEXT NOT NULL,
    violations TEXT NOT NULL DEFAULT '[]',
    recommendation TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_custom_metric_evaluations_profile
    ON custom_metric_evaluations(custom_metric_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_custom_metric_evaluations_status
    ON custom_metric_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_workstations (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    mode TEXT NOT NULL DEFAULT 'browser_context',
    workspace_path TEXT NOT NULL,
    browser_profile_path TEXT NOT NULL,
    temp_path TEXT NOT NULL,
    display_id TEXT,
    vnc_url TEXT,
    rdp_config TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_workstations_agent ON agent_workstations(agent_profile_id)`,

  `CREATE TABLE IF NOT EXISTS computer_sessions (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT,
    workflow_run_id TEXT,
    workstation_id TEXT REFERENCES agent_workstations(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'browser_context',
    workspace_path TEXT NOT NULL,
    browser_profile_path TEXT NOT NULL,
    temp_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_computer_sessions_employee_run
    ON computer_sessions(employee_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_computer_sessions_workflow_run
    ON computer_sessions(workflow_run_id)`,

  `CREATE TABLE IF NOT EXISTS computer_action_events (
    id TEXT PRIMARY KEY,
    computer_session_id TEXT NOT NULL REFERENCES computer_sessions(id) ON DELETE CASCADE,
    employee_run_id TEXT,
    workflow_run_id TEXT,
    action_type TEXT NOT NULL,
    target TEXT,
    input TEXT NOT NULL DEFAULT '{}',
    output TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_computer_action_events_session
    ON computer_action_events(computer_session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_computer_action_events_employee_run
    ON computer_action_events(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS browser_sessions (
    id TEXT PRIMARY KEY,
    session_name TEXT NOT NULL,
    owner_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    shared_with_agent_profile_ids TEXT NOT NULL DEFAULT '[]',
    cookie_jar_ref TEXT NOT NULL,
    local_storage_ref TEXT,
    indexed_db_ref TEXT,
    encrypted INTEGER NOT NULL DEFAULT 1,
    persist_after_task INTEGER NOT NULL DEFAULT 1,
    max_age TEXT NOT NULL DEFAULT '7d',
    keep_alive_enabled INTEGER NOT NULL DEFAULT 0,
    keep_alive_interval TEXT,
    keep_alive_visit_urls TEXT NOT NULL DEFAULT '[]',
    encrypt_sensitive_cookies INTEGER NOT NULL DEFAULT 1,
    isolate_by_agent INTEGER NOT NULL DEFAULT 1,
    exportable INTEGER NOT NULL DEFAULT 0,
    blocked_domains TEXT NOT NULL DEFAULT '[]',
    expires_at INTEGER,
    last_keep_alive_at INTEGER,
    next_keep_alive_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_browser_sessions_owner_status
    ON browser_sessions(owner_agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_browser_sessions_name
    ON browser_sessions(session_name)`,
  `CREATE INDEX IF NOT EXISTS idx_browser_sessions_expires
    ON browser_sessions(expires_at)`,

  `CREATE TABLE IF NOT EXISTS browser_session_events (
    id TEXT PRIMARY KEY,
    browser_session_id TEXT NOT NULL REFERENCES browser_sessions(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    domain TEXT,
    status TEXT NOT NULL DEFAULT 'recorded',
    message TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_browser_session_events_session
    ON browser_session_events(browser_session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_browser_session_events_type
    ON browser_session_events(event_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS memory_items (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    scope TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    source_run_id TEXT,
      embedding TEXT,
      confidence REAL NOT NULL DEFAULT 1,
      importance REAL NOT NULL DEFAULT 0.5,
      read_access TEXT NOT NULL DEFAULT 'organization',
      write_access TEXT NOT NULL DEFAULT 'only_me',
      encryption TEXT NOT NULL DEFAULT 'at_rest',
      contains_data_types TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_agent_scope ON memory_items(agent_profile_id, scope)`,

  `CREATE TABLE IF NOT EXISTS memory_graph_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    focus_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    project_id TEXT,
    layout TEXT NOT NULL DEFAULT 'force',
    include_expired INTEGER NOT NULL DEFAULT 0,
    filters TEXT NOT NULL DEFAULT '{}',
    nodes TEXT NOT NULL DEFAULT '[]',
    edges TEXT NOT NULL DEFAULT '[]',
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'generated',
    export_manifest TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_graph_views_agent
    ON memory_graph_views(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_graph_views_focus
    ON memory_graph_views(focus_agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_graph_views_status
    ON memory_graph_views(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS memory_decay_snapshots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    include_expired INTEGER NOT NULL DEFAULT 0,
    filters TEXT NOT NULL DEFAULT '{}',
    horizon_days INTEGER NOT NULL DEFAULT 180,
    stale_after_days INTEGER NOT NULL DEFAULT 45,
    expiring_soon_days INTEGER NOT NULL DEFAULT 30,
    pinned_importance_threshold REAL NOT NULL DEFAULT 0.95,
    points TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '{}',
    action_result TEXT NOT NULL DEFAULT '{}',
    point_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'generated',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_decay_snapshots_agent
    ON memory_decay_snapshots(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_memory_decay_snapshots_status
    ON memory_decay_snapshots(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS run_reflections (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    what_worked TEXT NOT NULL DEFAULT '[]',
    what_failed TEXT NOT NULL DEFAULT '[]',
    new_knowledge TEXT NOT NULL DEFAULT '[]',
    reusable_procedure TEXT NOT NULL DEFAULT '[]',
    suggested_skill_updates TEXT NOT NULL DEFAULT '[]',
    future_warnings TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_run_reflections_run ON run_reflections(run_id)`,

  `CREATE TABLE IF NOT EXISTS agent_diary_entries (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT,
    workflow_run_id TEXT,
    entry_type TEXT NOT NULL DEFAULT 'run_summary',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    next_actions TEXT NOT NULL DEFAULT '[]',
    blockers TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    importance REAL NOT NULL DEFAULT 0.5,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_diary_agent_created
    ON agent_diary_entries(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_diary_run
    ON agent_diary_entries(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS continuation_plans (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    source_run_id TEXT,
    workflow_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    next_steps TEXT NOT NULL DEFAULT '[]',
    resume_input TEXT NOT NULL DEFAULT '{}',
    required_capability_refs TEXT NOT NULL DEFAULT '[]',
    due_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_continuation_plans_agent_status
    ON continuation_plans(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_continuation_plans_source_run
    ON continuation_plans(source_run_id)`,

  `CREATE TABLE IF NOT EXISTS agent_retirement_plans (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    target_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    task_handling TEXT NOT NULL DEFAULT '{}',
    knowledge_extraction TEXT NOT NULL DEFAULT '{}',
    cleanup_policy TEXT NOT NULL DEFAULT '{}',
    analysis TEXT NOT NULL DEFAULT '{}',
    retirement_report TEXT NOT NULL DEFAULT '{}',
    farewell_message TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_retirement_agent_status
    ON agent_retirement_plans(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_retirement_target
    ON agent_retirement_plans(target_agent_profile_id)`,

  `CREATE TABLE IF NOT EXISTS knowledge_transfer_packages (
    id TEXT PRIMARY KEY,
    retirement_plan_id TEXT REFERENCES agent_retirement_plans(id) ON DELETE SET NULL,
    from_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    to_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending_review',
    receiver_handling TEXT NOT NULL DEFAULT 'review_each',
    transfer_items TEXT NOT NULL DEFAULT '{}',
    memory_item_ids TEXT NOT NULL DEFAULT '[]',
    playbook_ids TEXT NOT NULL DEFAULT '[]',
    created_memory_item_ids TEXT NOT NULL DEFAULT '[]',
    created_playbook_ids TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_transfer_from_status
    ON knowledge_transfer_packages(from_agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_transfer_to_status
    ON knowledge_transfer_packages(to_agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_transfer_retirement
    ON knowledge_transfer_packages(retirement_plan_id)`,

  `CREATE TABLE IF NOT EXISTS organizational_knowledge_items (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'all_agents',
    source_ref TEXT,
    insight_type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    pattern TEXT NOT NULL DEFAULT '',
    frequency INTEGER NOT NULL DEFAULT 1,
    effectiveness REAL NOT NULL DEFAULT 0,
    affected_agent_ids TEXT NOT NULL DEFAULT '[]',
    contributed_by_agent_ids TEXT NOT NULL DEFAULT '[]',
    evidence TEXT NOT NULL DEFAULT '[]',
    known_fix TEXT NOT NULL DEFAULT '',
    applicable_to TEXT NOT NULL DEFAULT '[]',
    software_name TEXT,
    status TEXT NOT NULL DEFAULT 'candidate',
    promoted_memory_item_id TEXT REFERENCES memory_items(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_org_knowledge_type_status
    ON organizational_knowledge_items(insight_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_org_knowledge_source
    ON organizational_knowledge_items(source, source_ref)`,

  `CREATE TABLE IF NOT EXISTS organizational_learning_reports (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'all_agents',
    source_ref TEXT,
    period_start_at INTEGER,
    period_end_at INTEGER,
    new_discoveries INTEGER NOT NULL DEFAULT 0,
    deprecated_knowledge INTEGER NOT NULL DEFAULT 0,
    top_insight TEXT NOT NULL DEFAULT '',
    recommended_actions TEXT NOT NULL DEFAULT '[]',
    insight_ids TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_org_learning_reports_source_period
    ON organizational_learning_reports(source, source_ref, created_at)`,

  `CREATE TABLE IF NOT EXISTS meta_agent_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    responsibilities TEXT NOT NULL DEFAULT '[]',
    special_capabilities TEXT NOT NULL DEFAULT '{}',
    restrictions TEXT NOT NULL DEFAULT '{}',
    schedule_local_time TEXT NOT NULL DEFAULT '08:00',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meta_agent_profiles_status
    ON meta_agent_profiles(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS meta_agent_digests (
    id TEXT PRIMARY KEY,
    meta_agent_profile_id TEXT REFERENCES meta_agent_profiles(id) ON DELETE SET NULL,
    date_label TEXT NOT NULL,
    summary TEXT NOT NULL,
    ready_agent_count INTEGER NOT NULL DEFAULT 0,
    warning_agent_count INTEGER NOT NULL DEFAULT 0,
    critical_agent_count INTEGER NOT NULL DEFAULT 0,
    pending_approval_count INTEGER NOT NULL DEFAULT 0,
    open_conflict_count INTEGER NOT NULL DEFAULT 0,
    queued_task_count INTEGER NOT NULL DEFAULT 0,
    failed_run_count INTEGER NOT NULL DEFAULT 0,
    monthly_cost_cents INTEGER NOT NULL DEFAULT 0,
    budget_remaining_percent REAL,
    anomalies TEXT NOT NULL DEFAULT '[]',
    recommendations TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meta_agent_digests_profile
    ON meta_agent_digests(meta_agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_meta_agent_digests_date
    ON meta_agent_digests(date_label)`,

  `CREATE TABLE IF NOT EXISTS meta_agent_recommendations (
    id TEXT PRIMARY KEY,
    meta_agent_profile_id TEXT REFERENCES meta_agent_profiles(id) ON DELETE SET NULL,
    digest_id TEXT REFERENCES meta_agent_digests(id) ON DELETE CASCADE,
    recommendation_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    target_type TEXT NOT NULL,
    target_id TEXT,
    title TEXT NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    proposed_action TEXT NOT NULL DEFAULT '{}',
    requires_approval INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meta_recommendations_digest
    ON meta_agent_recommendations(digest_id)`,
  `CREATE INDEX IF NOT EXISTS idx_meta_recommendations_status
    ON meta_agent_recommendations(status, severity)`,

  `CREATE TABLE IF NOT EXISTS learning_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    reflection_id TEXT REFERENCES run_reflections(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    proposed_playbook TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending_review',
    reviewer_note TEXT,
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_learning_events_run ON learning_events(run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_learning_events_status ON learning_events(status)`,

  `CREATE TABLE IF NOT EXISTS playbooks (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    source_learning_event_id TEXT REFERENCES learning_events(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playbooks_agent_status ON playbooks(agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS playbook_versions (
    id TEXT PRIMARY KEY,
    playbook_id TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    source_run_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playbook_versions_playbook
    ON playbook_versions(playbook_id, version)`,

  `CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS workflow_nodes (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    position TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    input_mapping TEXT NOT NULL DEFAULT '{}',
    output_contract TEXT NOT NULL DEFAULT '{}',
    retry_policy TEXT NOT NULL DEFAULT '{}',
    approval_policy TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow ON workflow_nodes(workflow_id)`,

  `CREATE TABLE IF NOT EXISTS workflow_edges (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    source_handle TEXT,
    target_handle TEXT,
    mapping TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow ON workflow_edges(workflow_id)`,

  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'queued',
    input TEXT NOT NULL DEFAULT '{}',
    output TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id)`,

  `CREATE TABLE IF NOT EXISTS workflow_node_runs (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    progress_status TEXT NOT NULL DEFAULT 'queued',
    current_step TEXT,
    output TEXT,
    error TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_node_runs_run ON workflow_node_runs(workflow_run_id)`,

  `CREATE TABLE IF NOT EXISTS workflow_preflights (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'ok',
    input TEXT NOT NULL DEFAULT '{}',
    budget_limit_cents INTEGER,
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    agent_count INTEGER NOT NULL DEFAULT 0,
    software_command_count INTEGER NOT NULL DEFAULT 0,
    approval_count INTEGER NOT NULL DEFAULT 0,
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    estimated_duration_ms INTEGER NOT NULL DEFAULT 0,
    resource_requirements TEXT NOT NULL DEFAULT '[]',
    issues TEXT NOT NULL DEFAULT '[]',
    risk_summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_preflights_workflow
    ON workflow_preflights(workflow_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_preflights_status
    ON workflow_preflights(status)`,

  `CREATE TABLE IF NOT EXISTS simulation_runs (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'dry_run',
    status TEXT NOT NULL DEFAULT 'awaiting_review',
    task_title TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    simulated_environment TEXT NOT NULL DEFAULT '{}',
    simulated_tool_results TEXT NOT NULL DEFAULT '[]',
    planned_steps TEXT NOT NULL DEFAULT '[]',
    review_adjustments TEXT NOT NULL DEFAULT '[]',
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    estimated_duration_ms INTEGER NOT NULL DEFAULT 0,
    approval_summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_simulation_runs_agent
    ON simulation_runs(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_simulation_runs_workflow
    ON simulation_runs(workflow_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_simulation_runs_status
    ON simulation_runs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS golden_task_sets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'agent',
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    tasks TEXT NOT NULL DEFAULT '[]',
    success_criteria TEXT NOT NULL DEFAULT '[]',
    ci_policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_golden_task_sets_agent
    ON golden_task_sets(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_golden_task_sets_workflow
    ON golden_task_sets(workflow_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_golden_task_sets_status
    ON golden_task_sets(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS backtest_runs (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'historical',
    target_type TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    golden_task_set_id TEXT REFERENCES golden_task_sets(id) ON DELETE SET NULL,
    baseline_version TEXT NOT NULL DEFAULT 'current',
    candidate_version TEXT NOT NULL DEFAULT 'candidate',
    candidate_changes TEXT NOT NULL DEFAULT '{}',
    tasks TEXT NOT NULL DEFAULT '[]',
    results TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL DEFAULT '{}',
    gate_status TEXT NOT NULL DEFAULT 'warning',
    success_rate_before REAL NOT NULL DEFAULT 0,
    success_rate_after REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_backtest_runs_agent
    ON backtest_runs(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_backtest_runs_workflow
    ON backtest_runs(workflow_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_backtest_runs_gate
    ON backtest_runs(gate_status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_backtest_runs_golden
    ON backtest_runs(golden_task_set_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS workflow_optimizations (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    run_count INTEGER NOT NULL DEFAULT 0,
    analysis TEXT NOT NULL DEFAULT '{}',
    auto_apply TEXT NOT NULL DEFAULT '{}',
    applied_changes TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'analyzed',
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_optimizations_workflow
    ON workflow_optimizations(workflow_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_optimizations_status
    ON workflow_optimizations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS natural_language_workflow_drafts (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    name TEXT NOT NULL,
    intent_type TEXT NOT NULL,
    parsed_intent TEXT NOT NULL DEFAULT '{}',
    workflow_preview TEXT NOT NULL DEFAULT '{}',
    agent_matches TEXT NOT NULL DEFAULT '{}',
    confidence REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'preview',
    created_workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_nl_workflow_drafts_status
    ON natural_language_workflow_drafts(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_nl_workflow_drafts_workflow
    ON natural_language_workflow_drafts(created_workflow_id)`,

  `CREATE TABLE IF NOT EXISTS task_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    parameters TEXT NOT NULL DEFAULT '{}',
    agent_role TEXT NOT NULL,
    workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    description_template TEXT NOT NULL,
    input_template TEXT NOT NULL DEFAULT '{}',
    estimated_duration TEXT NOT NULL DEFAULT '',
    estimated_cost REAL NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '[]',
    times_used INTEGER NOT NULL DEFAULT 0,
    avg_success_rate REAL NOT NULL DEFAULT 0,
    avg_duration TEXT NOT NULL DEFAULT '',
    avg_cost REAL NOT NULL DEFAULT 0,
    last_used INTEGER,
    related_memories TEXT NOT NULL DEFAULT '[]',
    required_skills TEXT NOT NULL DEFAULT '[]',
    sample_outputs TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_templates_category_status
    ON task_templates(category, status)`,
  `CREATE INDEX IF NOT EXISTS idx_task_templates_name
    ON task_templates(name)`,

  `CREATE TABLE IF NOT EXISTS task_template_runs (
    id TEXT PRIMARY KEY,
    task_template_id TEXT NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    parameters TEXT NOT NULL DEFAULT '{}',
    rendered_description TEXT NOT NULL,
    rendered_input TEXT NOT NULL DEFAULT '{}',
    estimated_duration TEXT NOT NULL DEFAULT '',
    estimated_cost REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'planned',
    success INTEGER,
    actual_duration TEXT,
    actual_cost REAL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_template_runs_template
    ON task_template_runs(task_template_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_template_runs_status
    ON task_template_runs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS task_queues (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    concurrency_limit INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_queues_status ON task_queues(status)`,

  `CREATE TABLE IF NOT EXISTS task_queue_items (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES task_queues(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    priority INTEGER NOT NULL DEFAULT 0,
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT,
    error TEXT,
    scheduled_at INTEGER NOT NULL,
    locked_at INTEGER,
    started_at INTEGER,
    finished_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_queue_items_queue_status
    ON task_queue_items(queue_id, status, scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_queue_items_priority
    ON task_queue_items(queue_id, priority, scheduled_at)`,

  `CREATE TABLE IF NOT EXISTS task_batches (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES task_queues(id) ON DELETE CASCADE,
    source_item_ids TEXT NOT NULL DEFAULT '[]',
    batch_item_id TEXT REFERENCES task_queue_items(id) ON DELETE SET NULL,
    strategy TEXT NOT NULL DEFAULT '{}',
    benefits TEXT NOT NULL DEFAULT '{}',
    merged_payload TEXT NOT NULL DEFAULT '{}',
    exclusion_reasons TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_batches_queue_status
    ON task_batches(queue_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_batches_batch_item
    ON task_batches(batch_item_id)`,

  `CREATE TABLE IF NOT EXISTS workflow_partial_rerun_plans (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
    from_node_id TEXT NOT NULL,
    rerun_node_ids TEXT NOT NULL DEFAULT '[]',
    cached_node_run_ids TEXT NOT NULL DEFAULT '[]',
    invalidated_node_run_ids TEXT NOT NULL DEFAULT '[]',
    input_patch TEXT NOT NULL DEFAULT '{}',
    cost_scope TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_partial_rerun_run_status
    ON workflow_partial_rerun_plans(workflow_run_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_partial_rerun_from_node
    ON workflow_partial_rerun_plans(from_node_id)`,

  `CREATE TABLE IF NOT EXISTS task_merge_suggestions (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    source_task_ids TEXT NOT NULL DEFAULT '[]',
    task_type TEXT NOT NULL DEFAULT 'general',
    merged_title TEXT NOT NULL,
    merged_payload TEXT NOT NULL DEFAULT '{}',
    benefits TEXT NOT NULL DEFAULT '{}',
    requires_user_approval INTEGER NOT NULL DEFAULT 1,
    user_decision TEXT,
    status TEXT NOT NULL DEFAULT 'suggested',
    created_at INTEGER NOT NULL,
    decided_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_merge_suggestions_agent
    ON task_merge_suggestions(agent_profile_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_merge_suggestions_status
    ON task_merge_suggestions(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS workflow_template_instantiations (
    id TEXT PRIMARY KEY,
    source_workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    instantiated_workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    parameter_schema TEXT NOT NULL DEFAULT '{}',
    parameters TEXT NOT NULL DEFAULT '{}',
    rendered_workflow TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    created_at INTEGER NOT NULL,
    instantiated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_template_instantiations_source
    ON workflow_template_instantiations(source_workflow_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_template_instantiations_status
    ON workflow_template_instantiations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS task_schedules (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL REFERENCES task_queues(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'task_queue_tick',
    status TEXT NOT NULL DEFAULT 'active',
    interval_ms INTEGER NOT NULL,
    next_run_at INTEGER NOT NULL,
    last_run_at INTEGER,
    payload TEXT NOT NULL DEFAULT '{}',
    last_result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_schedules_status_next
    ON task_schedules(status, next_run_at)`,
  `CREATE INDEX IF NOT EXISTS idx_task_schedules_queue
    ON task_schedules(queue_id, status)`,

  `CREATE TABLE IF NOT EXISTS acceptance_scenario_runs (
    id TEXT PRIMARY KEY,
    scenario_key TEXT NOT NULL,
    name TEXT NOT NULL,
    expected TEXT NOT NULL,
    steps TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'manual_required',
    step_results TEXT NOT NULL DEFAULT '[]',
    evidence TEXT NOT NULL DEFAULT '[]',
    gaps TEXT NOT NULL DEFAULT '[]',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_acceptance_scenario_runs_key_created
    ON acceptance_scenario_runs(scenario_key, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_acceptance_scenario_runs_status
    ON acceptance_scenario_runs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS resource_locks (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    owner_run_id TEXT NOT NULL,
    owner_agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'held',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    released_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_resource_locks_resource ON resource_locks(resource_type, resource_id, status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_locks_held_unique
    ON resource_locks(resource_type, resource_id)
    WHERE status = 'held'`,

  `CREATE TABLE IF NOT EXISTS os_interference_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    prevention_checklist TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_os_interference_policies_status
    ON os_interference_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_os_interference_policies_name
    ON os_interference_policies(name)`,

  `CREATE TABLE IF NOT EXISTS os_interference_events (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES os_interference_policies(id) ON DELETE SET NULL,
    signal TEXT NOT NULL,
    source_type TEXT NOT NULL,
    monitor_snapshot TEXT NOT NULL DEFAULT '{}',
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '',
    evidence_refs TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_os_interference_events_signal
    ON os_interference_events(signal, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_os_interference_events_status
    ON os_interference_events(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_os_interference_events_policy
    ON os_interference_events(policy_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS file_system_boundary_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_file_system_boundary_policies_status
    ON file_system_boundary_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_system_boundary_policies_name
    ON file_system_boundary_policies(name)`,

  `CREATE TABLE IF NOT EXISTS file_system_boundary_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES file_system_boundary_policies(id) ON DELETE SET NULL,
    requested_path TEXT NOT NULL DEFAULT '',
    normalized_path TEXT NOT NULL DEFAULT '',
    operation TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'windows',
    input TEXT NOT NULL DEFAULT '{}',
    risks TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_file_system_boundary_evaluations_policy
    ON file_system_boundary_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_system_boundary_evaluations_status
    ON file_system_boundary_evaluations(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_file_system_boundary_evaluations_operation
    ON file_system_boundary_evaluations(operation, created_at)`,

  `CREATE TABLE IF NOT EXISTS browser_automation_trap_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_browser_automation_trap_policies_status
    ON browser_automation_trap_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_browser_automation_trap_policies_name
    ON browser_automation_trap_policies(name)`,

  `CREATE TABLE IF NOT EXISTS browser_automation_trap_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES browser_automation_trap_policies(id) ON DELETE SET NULL,
    input TEXT NOT NULL DEFAULT '{}',
    risks TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_browser_automation_trap_evaluations_policy
    ON browser_automation_trap_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_browser_automation_trap_evaluations_status
    ON browser_automation_trap_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS enterprise_network_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_enterprise_network_policies_status
    ON enterprise_network_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_enterprise_network_policies_name
    ON enterprise_network_policies(name)`,

  `CREATE TABLE IF NOT EXISTS enterprise_network_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES enterprise_network_policies(id) ON DELETE SET NULL,
    input TEXT NOT NULL DEFAULT '{}',
    risks TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_enterprise_network_evaluations_policy
    ON enterprise_network_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_enterprise_network_evaluations_status
    ON enterprise_network_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS output_consistency_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_output_consistency_policies_status
    ON output_consistency_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_output_consistency_policies_name
    ON output_consistency_policies(name)`,

  `CREATE TABLE IF NOT EXISTS output_consistency_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES output_consistency_policies(id) ON DELETE SET NULL,
    input TEXT NOT NULL DEFAULT '{}',
    risks TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_output_consistency_evaluations_policy
    ON output_consistency_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_output_consistency_evaluations_status
    ON output_consistency_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS resource_governor_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_resource_governor_policies_status
    ON resource_governor_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_resource_governor_policies_name
    ON resource_governor_policies(name)`,

  `CREATE TABLE IF NOT EXISTS resource_governor_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES resource_governor_policies(id) ON DELETE SET NULL,
    snapshot TEXT NOT NULL DEFAULT '{}',
    decisions TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    max_concurrent_agents INTEGER NOT NULL DEFAULT 0,
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_resource_governor_evaluations_policy
    ON resource_governor_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_resource_governor_evaluations_status
    ON resource_governor_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS global_os_integration_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_global_os_integration_policies_status
    ON global_os_integration_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_global_os_integration_policies_name
    ON global_os_integration_policies(name)`,

  `CREATE TABLE IF NOT EXISTS global_os_integration_evaluations (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES global_os_integration_policies(id) ON DELETE SET NULL,
    input TEXT NOT NULL DEFAULT '{}',
    decisions TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    recommendation TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_global_os_integration_evaluations_policy
    ON global_os_integration_evaluations(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_global_os_integration_evaluations_status
    ON global_os_integration_evaluations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS telemetry_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_policies_status
    ON telemetry_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_policies_name
    ON telemetry_policies(name)`,

  `CREATE TABLE IF NOT EXISTS telemetry_events (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES telemetry_policies(id) ON DELETE SET NULL,
    requested_level TEXT NOT NULL,
    event_type TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    decision TEXT NOT NULL DEFAULT '{}',
    sanitized_payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL,
    blocked_fields TEXT NOT NULL DEFAULT '[]',
    redacted_fields TEXT NOT NULL DEFAULT '[]',
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_events_policy
    ON telemetry_events(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_events_status
    ON telemetry_events(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_events_type
    ON telemetry_events(event_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS telemetry_export_manifests (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES telemetry_policies(id) ON DELETE SET NULL,
    filters TEXT NOT NULL DEFAULT '{}',
    event_count INTEGER NOT NULL DEFAULT 0,
    manifest TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_export_manifests_policy
    ON telemetry_export_manifests(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_telemetry_export_manifests_created
    ON telemetry_export_manifests(created_at)`,

  `CREATE TABLE IF NOT EXISTS model_invocation_optimization_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_invocation_optimization_policies_status
    ON model_invocation_optimization_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_invocation_optimization_policies_name
    ON model_invocation_optimization_policies(name)`,

  `CREATE TABLE IF NOT EXISTS model_response_cache_entries (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES model_invocation_optimization_policies(id) ON DELETE SET NULL,
    model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    task_type TEXT NOT NULL DEFAULT 'other',
    strategy TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    semantic_key TEXT NOT NULL DEFAULT '',
    input_summary TEXT NOT NULL DEFAULT '',
    output TEXT NOT NULL DEFAULT '{}',
    cost_cents INTEGER NOT NULL DEFAULT 0,
    hit_count INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_response_cache_entries_hash
    ON model_response_cache_entries(policy_id, input_hash, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_response_cache_entries_semantic
    ON model_response_cache_entries(policy_id, semantic_key, expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_response_cache_entries_model
    ON model_response_cache_entries(model_profile_id, task_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS model_warmup_sessions (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES model_invocation_optimization_policies(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'warming',
    warmup_request TEXT NOT NULL DEFAULT '',
    display_status TEXT NOT NULL DEFAULT 'Agent warming...',
    connection_pool_plan TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_warmup_sessions_agent
    ON model_warmup_sessions(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_warmup_sessions_status
    ON model_warmup_sessions(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS model_invocation_optimization_events (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES model_invocation_optimization_policies(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    task_type TEXT NOT NULL DEFAULT 'other',
    status TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_model_invocation_optimization_events_policy
    ON model_invocation_optimization_events(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_model_invocation_optimization_events_type
    ON model_invocation_optimization_events(event_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS runtime_micro_operation_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    policy TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_micro_operation_policies_status
    ON runtime_micro_operation_policies(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_micro_operation_policies_name
    ON runtime_micro_operation_policies(name)`,

  `CREATE TABLE IF NOT EXISTS runtime_micro_operation_decisions (
    id TEXT PRIMARY KEY,
    policy_id TEXT REFERENCES runtime_micro_operation_policies(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    decision_type TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_micro_operation_decisions_policy
    ON runtime_micro_operation_decisions(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_micro_operation_decisions_agent
    ON runtime_micro_operation_decisions(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_micro_operation_decisions_status
    ON runtime_micro_operation_decisions(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS scheduled_actions (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    instruction TEXT NOT NULL,
    due_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    payload TEXT NOT NULL DEFAULT '{}',
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_actions_due
    ON scheduled_actions(status, due_at)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_actions_agent
    ON scheduled_actions(agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS agent_inbox_items (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    item_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    priority INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'unread',
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    processed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_inbox_items_agent_status
    ON agent_inbox_items(agent_profile_id, status, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_inbox_items_status
    ON agent_inbox_items(status, priority, created_at)`,

  `CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
    run_id TEXT,
    node_run_id TEXT,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    risk_level TEXT NOT NULL DEFAULT 'medium',
    payload TEXT NOT NULL DEFAULT '{}',
    response TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status)`,

  `CREATE TABLE IF NOT EXISTS human_approval_policies (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    workflow_id TEXT REFERENCES workflows(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_human_approval_policies_agent
    ON human_approval_policies(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_human_approval_policies_workflow
    ON human_approval_policies(workflow_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_human_approval_policies_status
    ON human_approval_policies(status)`,

  `CREATE TABLE IF NOT EXISTS plan_approval_results (
    id TEXT PRIMARY KEY,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    plan_id TEXT,
    step_decisions TEXT NOT NULL DEFAULT '[]',
    overall_decision TEXT NOT NULL DEFAULT 'approved',
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_plan_approval_results_request
    ON plan_approval_results(approval_request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_approval_results_agent
    ON plan_approval_results(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_approval_results_run
    ON plan_approval_results(employee_run_id, workflow_run_id)`,

  `CREATE TABLE IF NOT EXISTS takeover_sessions (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    step_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    user_actions TEXT NOT NULL DEFAULT '[]',
    observation TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_takeover_sessions_run
    ON takeover_sessions(run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_takeover_sessions_agent
    ON takeover_sessions(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_takeover_sessions_resource
    ON takeover_sessions(resource, status)`,

  `CREATE TABLE IF NOT EXISTS agent_probation_records (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    environment TEXT NOT NULL DEFAULT 'staging',
    status TEXT NOT NULL DEFAULT 'probation',
    risk_tier TEXT NOT NULL DEFAULT 'high',
    task_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    success_rate REAL NOT NULL DEFAULT 0,
    promotion_task_threshold INTEGER NOT NULL DEFAULT 10,
    promotion_success_rate_threshold REAL NOT NULL DEFAULT 0.8,
    restrictions TEXT NOT NULL DEFAULT '{}',
    evaluation TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    graduated_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_probation_records_agent
    ON agent_probation_records(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_probation_records_environment
    ON agent_probation_records(environment, risk_tier)`,

  `CREATE TABLE IF NOT EXISTS agent_environment_promotions (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    probation_record_id TEXT REFERENCES agent_probation_records(id) ON DELETE SET NULL,
    from_environment TEXT NOT NULL DEFAULT 'staging',
    to_environment TEXT NOT NULL DEFAULT 'production',
    status TEXT NOT NULL DEFAULT 'requested',
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    ab_comparison TEXT NOT NULL DEFAULT '{}',
    decision_note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    decided_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_environment_promotions_agent
    ON agent_environment_promotions(agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_environment_promotions_approval
    ON agent_environment_promotions(approval_request_id)`,

  `CREATE TABLE IF NOT EXISTS mcp_tool_calls (
    id TEXT PRIMARY KEY,
    mcp_tool_definition_id TEXT NOT NULL REFERENCES mcp_tool_definitions(id) ON DELETE CASCADE,
    mcp_server_id TEXT REFERENCES mcp_servers(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    workflow_node_run_id TEXT REFERENCES workflow_node_runs(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'dry_run',
    status TEXT NOT NULL DEFAULT 'planned',
    input TEXT NOT NULL DEFAULT '{}',
    output TEXT,
    error TEXT,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    autonomy_decision_id TEXT REFERENCES autonomy_decisions(id) ON DELETE SET NULL,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_definition_created
    ON mcp_tool_calls(mcp_tool_definition_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_server
    ON mcp_tool_calls(mcp_server_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_employee_run
    ON mcp_tool_calls(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS software_command_runs (
    id TEXT PRIMARY KEY,
    software_command_id TEXT NOT NULL REFERENCES software_commands(id) ON DELETE CASCADE,
    software_profile_id TEXT REFERENCES software_profiles(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    workflow_node_run_id TEXT REFERENCES workflow_node_runs(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'dry_run',
    status TEXT NOT NULL DEFAULT 'planned',
    adapter_type TEXT NOT NULL,
    implementation_type TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    output TEXT,
    error TEXT,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_software_command_runs_command_created
    ON software_command_runs(software_command_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_software_command_runs_workflow
    ON software_command_runs(workflow_run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_software_command_runs_node
    ON software_command_runs(workflow_node_run_id)`,

  `CREATE TABLE IF NOT EXISTS macro_replay_runs (
    id TEXT PRIMARY KEY,
    recorded_macro_id TEXT NOT NULL REFERENCES recorded_macros(id) ON DELETE CASCADE,
    software_profile_id TEXT REFERENCES software_profiles(id) ON DELETE SET NULL,
    software_command_id TEXT REFERENCES software_commands(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'dry_run',
    status TEXT NOT NULL DEFAULT 'planned',
    input TEXT NOT NULL DEFAULT '{}',
    output TEXT,
    error TEXT,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    autonomy_decision_id TEXT REFERENCES autonomy_decisions(id) ON DELETE SET NULL,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_macro_replay_runs_macro
    ON macro_replay_runs(recorded_macro_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_macro_replay_runs_agent
    ON macro_replay_runs(agent_profile_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS artifact_validations (
    id TEXT PRIMARY KEY,
    artifact_id TEXT REFERENCES artifacts(id) ON DELETE CASCADE,
    run_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    rules TEXT NOT NULL DEFAULT '[]',
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_validations_artifact ON artifact_validations(artifact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_artifact_validations_run ON artifact_validations(run_id)`,

  `CREATE TABLE IF NOT EXISTS employee_runs (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    goal TEXT NOT NULL,
    input TEXT NOT NULL DEFAULT '{}',
    plan TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'queued',
    current_phase TEXT NOT NULL DEFAULT 'queued',
    current_step TEXT,
    output TEXT,
    error TEXT,
    budget_limit_cents INTEGER,
    estimated_cost_cents INTEGER NOT NULL DEFAULT 0,
    actual_cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    updated_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_employee_runs_agent_status ON employee_runs(agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS onboarding_sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'started',
    current_step TEXT NOT NULL DEFAULT 'welcome',
    selected_work_type TEXT,
    created_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    demo_employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    checklist TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_status
    ON onboarding_sessions(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_onboarding_sessions_agent
    ON onboarding_sessions(created_agent_profile_id)`,

  `CREATE TABLE IF NOT EXISTS multimodal_inputs (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    mime_type TEXT,
    source TEXT NOT NULL DEFAULT 'user',
    data_ref TEXT,
    description TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'registered',
    validation_result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_multimodal_inputs_run
    ON multimodal_inputs(employee_run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_multimodal_inputs_agent
    ON multimodal_inputs(agent_profile_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_multimodal_inputs_kind
    ON multimodal_inputs(kind, status)`,

  `CREATE TABLE IF NOT EXISTS multimodal_outputs (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
    path TEXT,
    caption TEXT,
    format TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    metadata TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'registered',
    validation_result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_multimodal_outputs_run
    ON multimodal_outputs(employee_run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_multimodal_outputs_agent
    ON multimodal_outputs(agent_profile_id, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_multimodal_outputs_kind
    ON multimodal_outputs(kind, status)`,

  `CREATE TABLE IF NOT EXISTS runtime_context_snapshots (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    prompt_template_id TEXT REFERENCES prompt_templates(id) ON DELETE SET NULL,
    prompt_template_version_id TEXT REFERENCES prompt_template_versions(id) ON DELETE SET NULL,
    summary TEXT NOT NULL,
    visible_context TEXT NOT NULL DEFAULT '{}',
    token_budget INTEGER,
    token_estimate INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_context_snapshots_run
    ON runtime_context_snapshots(employee_run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_context_snapshots_agent
    ON runtime_context_snapshots(agent_profile_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS context_compression_plans (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL REFERENCES context_compressor_policies(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    runtime_context_snapshot_id TEXT REFERENCES runtime_context_snapshots(id) ON DELETE SET NULL,
    goal TEXT NOT NULL DEFAULT '',
    input TEXT NOT NULL DEFAULT '{}',
    token_budget INTEGER NOT NULL,
    token_estimate INTEGER NOT NULL,
    trigger_threshold_tokens INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    strategy TEXT NOT NULL,
    preserve_always TEXT NOT NULL DEFAULT '[]',
    summarizer_model TEXT NOT NULL,
    allocation TEXT NOT NULL DEFAULT '{}',
    preserved_sections TEXT NOT NULL DEFAULT '[]',
    compressed_sections TEXT NOT NULL DEFAULT '[]',
    omitted_sections TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_compression_plans_policy
    ON context_compression_plans(policy_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_context_compression_plans_agent
    ON context_compression_plans(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_context_compression_plans_status
    ON context_compression_plans(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS context_window_visualizations (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    runtime_context_snapshot_id TEXT REFERENCES runtime_context_snapshots(id) ON DELETE SET NULL,
    goal TEXT NOT NULL DEFAULT '',
    token_capacity INTEGER NOT NULL,
    tokens_used INTEGER NOT NULL,
    token_estimate INTEGER NOT NULL,
    overflow_tokens INTEGER NOT NULL DEFAULT 0,
    remaining_tokens INTEGER NOT NULL,
    used_percent REAL NOT NULL,
    segments TEXT NOT NULL DEFAULT '[]',
    content_type_breakdown TEXT NOT NULL DEFAULT '[]',
    importance_breakdown TEXT NOT NULL DEFAULT '[]',
    suggestions TEXT NOT NULL DEFAULT '[]',
    compressible_tokens INTEGER NOT NULL DEFAULT 0,
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_context_window_visualizations_agent
    ON context_window_visualizations(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_context_window_visualizations_run
    ON context_window_visualizations(employee_run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_context_window_visualizations_snapshot
    ON context_window_visualizations(runtime_context_snapshot_id)`,

  `CREATE TABLE IF NOT EXISTS inter_agent_messages (
    id TEXT PRIMARY KEY,
    sender_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    recipient_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    channel TEXT NOT NULL DEFAULT 'default',
    message_type TEXT NOT NULL DEFAULT 'status',
    content TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'sent',
    created_at INTEGER NOT NULL,
    read_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inter_agent_messages_channel_created
    ON inter_agent_messages(channel, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_inter_agent_messages_recipient
    ON inter_agent_messages(recipient_agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS agent_communication_protocols (
    id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    required_top_level_fields TEXT NOT NULL DEFAULT '[]',
    header_fields TEXT NOT NULL DEFAULT '[]',
    body_fields TEXT NOT NULL DEFAULT '[]',
    context_fields TEXT NOT NULL DEFAULT '[]',
    supports_signature INTEGER NOT NULL DEFAULT 1,
    default_ttl_ms INTEGER NOT NULL DEFAULT 3600000,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_communication_protocols_version
    ON agent_communication_protocols(version, status)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_communication_protocols_status
    ON agent_communication_protocols(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS agent_protocol_messages (
    id TEXT PRIMARY KEY,
    protocol_id TEXT NOT NULL REFERENCES agent_communication_protocols(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    message_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    ttl_ms INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    from_agent_id TEXT,
    to_agent_id TEXT,
    message_type TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    reply_to TEXT,
    intent TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '{}',
    proposed_action TEXT,
    signature TEXT,
    validation_status TEXT NOT NULL DEFAULT 'valid',
    validation_errors TEXT NOT NULL DEFAULT '[]',
    envelope TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_protocol_messages_message
    ON agent_protocol_messages(message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_protocol_messages_from
    ON agent_protocol_messages(from_agent_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_protocol_messages_to
    ON agent_protocol_messages(to_agent_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_protocol_messages_type
    ON agent_protocol_messages(message_type, priority)`,

  `CREATE TABLE IF NOT EXISTS stream_protocol_channels (
    id TEXT PRIMARY KEY,
    stream TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    primary_transport TEXT NOT NULL DEFAULT 'websocket',
    fallback_transport TEXT NOT NULL DEFAULT 'sse',
    replay_retention_ms INTEGER NOT NULL DEFAULT 3600000,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_protocol_channels_stream
    ON stream_protocol_channels(stream)`,
  `CREATE INDEX IF NOT EXISTS idx_stream_protocol_channels_status
    ON stream_protocol_channels(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS stream_protocol_events (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES stream_protocol_channels(id) ON DELETE CASCADE,
    stream TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    message_type TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_protocol_events_stream_sequence
    ON stream_protocol_events(stream, sequence)`,
  `CREATE INDEX IF NOT EXISTS idx_stream_protocol_events_channel_created
    ON stream_protocol_events(channel_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS stream_replay_cursors (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES stream_protocol_channels(id) ON DELETE CASCADE,
    stream TEXT NOT NULL,
    client_id TEXT NOT NULL,
    last_sequence INTEGER NOT NULL DEFAULT 0,
    transport TEXT NOT NULL DEFAULT 'sse',
    disconnected_at INTEGER,
    replayed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_replay_cursors_client
    ON stream_replay_cursors(client_id, stream)`,
  `CREATE INDEX IF NOT EXISTS idx_stream_replay_cursors_channel
    ON stream_replay_cursors(channel_id, updated_at)`,

  `CREATE TABLE IF NOT EXISTS blackboard_entries (
    id TEXT PRIMARY KEY,
    scope_type TEXT NOT NULL,
    scope_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '{}',
    author_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_blackboard_entries_scope_key
    ON blackboard_entries(scope_type, scope_id, key, status)`,

  `CREATE TABLE IF NOT EXISTS agent_team_dashboard_snapshots (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    agent_profile_ids TEXT NOT NULL DEFAULT '[]',
    cards TEXT NOT NULL DEFAULT '[]',
    blackboard_items TEXT NOT NULL DEFAULT '[]',
    active_run_count INTEGER NOT NULL DEFAULT 0,
    waiting_approval_count INTEGER NOT NULL DEFAULT 0,
    blocked_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'live',
    export_manifest TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_team_dashboards_workflow
    ON agent_team_dashboard_snapshots(workflow_run_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_team_dashboards_status
    ON agent_team_dashboard_snapshots(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS agent_team_dashboard_commands (
    id TEXT PRIMARY KEY,
    dashboard_snapshot_id TEXT NOT NULL REFERENCES agent_team_dashboard_snapshots(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    affected_agent_profile_ids TEXT NOT NULL DEFAULT '[]',
    affected_employee_run_ids TEXT NOT NULL DEFAULT '[]',
    skipped_employee_run_ids TEXT NOT NULL DEFAULT '[]',
    summary TEXT NOT NULL,
    export_manifest TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_team_dashboard_commands_snapshot
    ON agent_team_dashboard_commands(dashboard_snapshot_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_agent_team_dashboard_commands_type
    ON agent_team_dashboard_commands(command_type, status)`,

  `CREATE TABLE IF NOT EXISTS cicd_integrations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT NOT NULL,
    mode TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    agent_name TEXT NOT NULL,
    task TEXT NOT NULL,
    max_budget_dollars REAL NOT NULL DEFAULT 0.5,
    fail_on TEXT NOT NULL DEFAULT 'security_issue_found',
    output_artifacts INTEGER NOT NULL DEFAULT 1,
    post_as_pr_comment INTEGER NOT NULL DEFAULT 1,
    auto_fix INTEGER NOT NULL DEFAULT 0,
    exit_code_mapping TEXT NOT NULL DEFAULT '{}',
    workflow_template TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cicd_integrations_platform
    ON cicd_integrations(platform, status)`,
  `CREATE INDEX IF NOT EXISTS idx_cicd_integrations_agent
    ON cicd_integrations(agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS cicd_runs (
    id TEXT PRIMARY KEY,
    integration_id TEXT NOT NULL REFERENCES cicd_integrations(id) ON DELETE CASCADE,
    trigger_type TEXT NOT NULL,
    ref_name TEXT NOT NULL DEFAULT '',
    commit_sha TEXT NOT NULL DEFAULT '',
    pull_request_number INTEGER,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    agent_conclusion TEXT NOT NULL DEFAULT 'passed',
    exit_code INTEGER NOT NULL DEFAULT 0,
    artifact_manifest TEXT NOT NULL DEFAULT '{}',
    pr_comment TEXT NOT NULL DEFAULT '{}',
    auto_fix_plan TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cicd_runs_integration
    ON cicd_runs(integration_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cicd_runs_status
    ON cicd_runs(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS capability_negotiations (
    id TEXT PRIMARY KEY,
    requester_agent_profile_id TEXT NOT NULL REFERENCES agent_profiles(id) ON DELETE CASCADE,
    workflow_run_id TEXT REFERENCES workflow_runs(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    task_goal TEXT NOT NULL,
    required_capabilities TEXT NOT NULL DEFAULT '[]',
    available_capabilities TEXT NOT NULL DEFAULT '[]',
    missing_capabilities TEXT NOT NULL DEFAULT '[]',
    strategies TEXT NOT NULL DEFAULT '{}',
    candidate_agent_profile_ids TEXT NOT NULL DEFAULT '[]',
    selected_strategy TEXT,
    resolution TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_capability_negotiations_requester
    ON capability_negotiations(requester_agent_profile_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_capability_negotiations_status
    ON capability_negotiations(status, updated_at)`,
  `CREATE INDEX IF NOT EXISTS idx_capability_negotiations_employee_run
    ON capability_negotiations(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS capability_negotiation_events (
    id TEXT PRIMARY KEY,
    negotiation_id TEXT NOT NULL REFERENCES capability_negotiations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    protocol_message_id TEXT REFERENCES agent_protocol_messages(id) ON DELETE SET NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_capability_negotiation_events_negotiation
    ON capability_negotiation_events(negotiation_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_capability_negotiation_events_type
    ON capability_negotiation_events(event_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS conflict_resolutions (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    conflict_type TEXT NOT NULL,
    participants TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'open',
    summary TEXT NOT NULL DEFAULT '',
    resolution TEXT,
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conflict_resolutions_resource
    ON conflict_resolutions(resource_type, resource_id, status)`,

  `CREATE TABLE IF NOT EXISTS conflict_escalations (
    id TEXT PRIMARY KEY,
    conflict_resolution_id TEXT NOT NULL REFERENCES conflict_resolutions(id) ON DELETE CASCADE,
    level INTEGER NOT NULL,
    name TEXT NOT NULL,
    action TEXT NOT NULL,
    max_attempts INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    timeout_ms INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    recommendation TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    due_at INTEGER,
    completed_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conflict_escalations_conflict
    ON conflict_escalations(conflict_resolution_id, level)`,
  `CREATE INDEX IF NOT EXISTS idx_conflict_escalations_status
    ON conflict_escalations(status, due_at)`,

  `CREATE TABLE IF NOT EXISTS realtime_collab_sessions (
    id TEXT PRIMARY KEY,
    document_path TEXT NOT NULL,
    protocol TEXT NOT NULL DEFAULT 'segment_lock',
    conflict_resolution TEXT NOT NULL DEFAULT 'user_wins',
    show_agent_cursor INTEGER NOT NULL DEFAULT 1,
    show_agent_selection INTEGER NOT NULL DEFAULT 1,
    agent_aware_of_user_edits INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    current_version INTEGER NOT NULL DEFAULT 1,
    created_by TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_collab_sessions_path
    ON realtime_collab_sessions(document_path, status)`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_collab_sessions_status
    ON realtime_collab_sessions(status, updated_at)`,

  `CREATE TABLE IF NOT EXISTS realtime_segment_locks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES realtime_collab_sessions(id) ON DELETE CASCADE,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    participant_type TEXT NOT NULL,
    participant_id TEXT,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    cursor_line INTEGER,
    cursor_column INTEGER,
    status TEXT NOT NULL DEFAULT 'active',
    conflict_id TEXT REFERENCES conflict_resolutions(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    released_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_segment_locks_session
    ON realtime_segment_locks(session_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_segment_locks_file
    ON realtime_segment_locks(file_path, start_line, end_line)`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_segment_locks_agent
    ON realtime_segment_locks(agent_profile_id, status)`,

  `CREATE TABLE IF NOT EXISTS realtime_edit_operations (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES realtime_collab_sessions(id) ON DELETE CASCADE,
    segment_lock_id TEXT REFERENCES realtime_segment_locks(id) ON DELETE SET NULL,
    participant_type TEXT NOT NULL,
    participant_id TEXT,
    file_path TEXT NOT NULL,
    operation_kind TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    base_version INTEGER NOT NULL,
    new_text TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    conflict_id TEXT REFERENCES conflict_resolutions(id) ON DELETE SET NULL,
    result TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_edit_operations_session
    ON realtime_edit_operations(session_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_edit_operations_lock
    ON realtime_edit_operations(segment_lock_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_realtime_edit_operations_status
    ON realtime_edit_operations(status, created_at)`,

  `CREATE TABLE IF NOT EXISTS cli_runs (
    id TEXT PRIMARY KEY,
    cli_profile_id TEXT NOT NULL REFERENCES cli_profiles(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    employee_run_id TEXT REFERENCES employee_runs(id) ON DELETE SET NULL,
    mode TEXT NOT NULL DEFAULT 'dry_run',
    status TEXT NOT NULL DEFAULT 'planned',
    command TEXT NOT NULL,
    rendered_args TEXT NOT NULL DEFAULT '',
    cwd TEXT NOT NULL,
    env_keys TEXT NOT NULL DEFAULT '[]',
    stdin_preview TEXT,
    output TEXT,
    error TEXT,
    requires_approval INTEGER NOT NULL DEFAULT 1,
    approval_request_id TEXT REFERENCES approval_requests(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cli_runs_profile_created ON cli_runs(cli_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_cli_runs_employee_run ON cli_runs(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS employee_run_events (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT NOT NULL REFERENCES employee_runs(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    phase TEXT NOT NULL,
    message TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_employee_run_events_run_created ON employee_run_events(employee_run_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS runtime_checkpoints (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT NOT NULL REFERENCES employee_runs(id) ON DELETE CASCADE,
    step_index INTEGER NOT NULL,
    phase TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    summary TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_runtime_checkpoints_run_step ON runtime_checkpoints(employee_run_id, step_index)`,

  `CREATE TABLE IF NOT EXISTS recovery_events (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'recorded',
    summary TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_events_resource
    ON recovery_events(resource_type, resource_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS error_classifications (
    id TEXT PRIMARY KEY,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    message TEXT NOT NULL,
    normalized_error TEXT NOT NULL,
    context TEXT NOT NULL DEFAULT '{}',
    suggested_strategy TEXT NOT NULL,
    suggested_strategy_config TEXT NOT NULL DEFAULT '{}',
    strategy_rankings TEXT NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL DEFAULT 0.5,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_error_classifications_resource
    ON error_classifications(resource_type, resource_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_error_classifications_agent
    ON error_classifications(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_error_classifications_category
    ON error_classifications(category, severity, created_at)`,

  `CREATE TABLE IF NOT EXISTS recovery_strategy_attempts (
    id TEXT PRIMARY KEY,
    classification_id TEXT NOT NULL REFERENCES error_classifications(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    strategy_type TEXT NOT NULL,
    strategy_config TEXT NOT NULL DEFAULT '{}',
    outcome TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_strategy_attempts_classification
    ON recovery_strategy_attempts(classification_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_strategy_attempts_agent
    ON recovery_strategy_attempts(agent_profile_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_strategy_attempts_category_strategy
    ON recovery_strategy_attempts(category, strategy_type, created_at)`,

  `CREATE TABLE IF NOT EXISTS recovery_strategy_stats (
    id TEXT PRIMARY KEY,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    strategy_type TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    success_rate REAL NOT NULL DEFAULT 0,
    last_outcome TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_strategy_stats_agent_category
    ON recovery_strategy_stats(agent_profile_id, category)`,
  `CREATE INDEX IF NOT EXISTS idx_recovery_strategy_stats_category_strategy
    ON recovery_strategy_stats(category, strategy_type)`,

  `CREATE TABLE IF NOT EXISTS idempotency_records (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL DEFAULT 'global',
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'started',
    result TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_idempotency_records_scope
    ON idempotency_records(scope, status)`,
  `CREATE INDEX IF NOT EXISTS idx_idempotency_records_resource
    ON idempotency_records(resource_type, resource_id)`,

  `CREATE TABLE IF NOT EXISTS budget_events (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT NOT NULL REFERENCES employee_runs(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    amount_cents INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_budget_events_run ON budget_events(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS decision_audit_trails (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT NOT NULL REFERENCES employee_runs(id) ON DELETE CASCADE,
    decision_type TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    decision TEXT NOT NULL,
    rationale TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decision_audit_run ON decision_audit_trails(employee_run_id)`,

  `CREATE TABLE IF NOT EXISTS decision_rollbacks (
    id TEXT PRIMARY KEY,
    employee_run_id TEXT NOT NULL REFERENCES employee_runs(id) ON DELETE CASCADE,
    agent_profile_id TEXT REFERENCES agent_profiles(id) ON DELETE SET NULL,
    target_decision_id TEXT REFERENCES decision_audit_trails(id) ON DELETE SET NULL,
    granularity TEXT NOT NULL,
    rollback_scope TEXT NOT NULL DEFAULT '{}',
    reason_type TEXT NOT NULL,
    reason_description TEXT NOT NULL,
    reason_timestamp INTEGER NOT NULL,
    affected_decision_ids TEXT NOT NULL DEFAULT '[]',
    affected_memory_ids TEXT NOT NULL DEFAULT '[]',
    affected_peer_agent_ids TEXT NOT NULL DEFAULT '[]',
    what_was_lost TEXT NOT NULL DEFAULT '[]',
    cost_of_rollback_cents INTEGER NOT NULL DEFAULT 0,
    rollback_history TEXT NOT NULL DEFAULT '[]',
    restart_plan TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'planned',
    created_at INTEGER NOT NULL,
    applied_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_decision_rollbacks_run
    ON decision_rollbacks(employee_run_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_decision_rollbacks_target
    ON decision_rollbacks(target_decision_id)`,
  `CREATE INDEX IF NOT EXISTS idx_decision_rollbacks_reason
    ON decision_rollbacks(reason_type, created_at)`,
]

/** 建表 / 建索引（幂等）。 */
function ensureSchema(sqlite: Database.Database): void {
  for (const stmt of DDL) {
    sqlite.exec(stmt)
  }
  safeAlter(sqlite, `ALTER TABLE app_settings ADD COLUMN companion_mode TEXT NOT NULL DEFAULT 'off'`)
  safeAlter(sqlite, `ALTER TABLE app_settings ADD COLUMN mobile_device_token TEXT`)
  safeAlter(sqlite, `ALTER TABLE app_settings ADD COLUMN deployment_publish_enabled INTEGER NOT NULL DEFAULT 0`)
  safeAlter(sqlite, `ALTER TABLE app_settings ADD COLUMN deployment_publish_dir TEXT`)
  safeAlter(sqlite, `ALTER TABLE app_settings ADD COLUMN deployment_public_base_url TEXT`)
  safeAlter(sqlite, `ALTER TABLE memory_items ADD COLUMN read_access TEXT NOT NULL DEFAULT 'organization'`)
  safeAlter(sqlite, `ALTER TABLE memory_items ADD COLUMN write_access TEXT NOT NULL DEFAULT 'only_me'`)
  safeAlter(sqlite, `ALTER TABLE memory_items ADD COLUMN encryption TEXT NOT NULL DEFAULT 'at_rest'`)
  safeAlter(sqlite, `ALTER TABLE memory_items ADD COLUMN contains_data_types TEXT NOT NULL DEFAULT '[]'`)
  safeAlter(sqlite, `ALTER TABLE knowledge_graph_nodes ADD COLUMN embedding TEXT NOT NULL DEFAULT '[]'`)
  safeAlter(sqlite, `ALTER TABLE agent_profiles ADD COLUMN persona TEXT NOT NULL DEFAULT '{}'`)
  safeAlter(sqlite, `ALTER TABLE prompt_templates ADD COLUMN engine TEXT NOT NULL DEFAULT 'handlebars'`)
  safeAlter(sqlite, `ALTER TABLE prompt_templates ADD COLUMN template TEXT NOT NULL DEFAULT ''`)
  safeAlter(sqlite, `ALTER TABLE prompt_templates ADD COLUMN variables TEXT NOT NULL DEFAULT '{}'`)
  safeAlter(sqlite, `ALTER TABLE prompt_templates ADD COLUMN conditional_blocks TEXT NOT NULL DEFAULT '[]'`)
  safeAlter(sqlite, `ALTER TABLE prompt_template_versions ADD COLUMN content TEXT NOT NULL DEFAULT ''`)
  safeAlter(sqlite, `ALTER TABLE prompt_template_versions ADD COLUMN ab_test TEXT`)
  safeAlter(sqlite, `ALTER TABLE prompt_template_versions ADD COLUMN deployed_at INTEGER`)
  safeAlter(sqlite, `ALTER TABLE prompt_template_versions ADD COLUMN retired_at INTEGER`)
  safeAlter(sqlite, `ALTER TABLE agents ADD COLUMN skill_ids TEXT NOT NULL DEFAULT '[]'`)
  safeAlter(sqlite, `ALTER TABLE agents ADD COLUMN mcp_server_ids TEXT NOT NULL DEFAULT '[]'`)
  safeAlter(sqlite, `ALTER TABLE agents ADD COLUMN cli_profile_ids TEXT NOT NULL DEFAULT '[]'`)
  safeAlter(sqlite, `ALTER TABLE conversations ADD COLUMN model_profile_id TEXT REFERENCES model_profiles(id) ON DELETE SET NULL`)
}

function safeAlter(sqlite: Database.Database, stmt: string): void {
  try {
    sqlite.exec(stmt)
  } catch (err) {
    if (err instanceof Error && err.message.includes('duplicate column name')) return
    throw err
  }
}

/** 已有任意 builtin agent 就跳过；否则一次插入全部。 */
function ensureBuiltinAgents(sqlite: Database.Database): void {
  const row = sqlite
    .prepare('SELECT 1 AS one FROM agents WHERE is_builtin = 1 LIMIT 1')
    .get()
  if (row) return

  const insert = sqlite.prepare(`
    INSERT INTO agents (
      id, name, avatar, description, capabilities, system_prompt,
      adapter_name, model_provider, model_id, api_key, api_base_url,
      tool_names, skill_ids, mcp_server_ids, cli_profile_ids,
      is_builtin, is_orchestrator, supports_vision, created_at
    ) VALUES (
      @id, @name, @avatar, @description, @capabilities, @system_prompt,
      @adapter_name, @model_provider, @model_id, @api_key, @api_base_url,
      @tool_names, @skill_ids, @mcp_server_ids, @cli_profile_ids,
      @is_builtin, @is_orchestrator, @supports_vision, @created_at
    )
  `)

  const tx = sqlite.transaction((agents: typeof BUILTIN_AGENTS) => {
    for (const a of agents) {
      insert.run({
        id: a.id,
        name: a.name,
        avatar: a.avatar,
        description: a.description,
        capabilities: JSON.stringify(a.capabilities),
        system_prompt: a.systemPrompt,
        adapter_name: a.adapterName,
        model_provider: a.modelProvider ?? null,
        model_id: a.modelId ?? null,
        api_key: a.apiKey ?? null,
        api_base_url: a.apiBaseUrl ?? null,
        tool_names: JSON.stringify(a.toolNames),
        skill_ids: JSON.stringify([]),
        mcp_server_ids: JSON.stringify([]),
        cli_profile_ids: JSON.stringify([]),
        is_builtin: a.isBuiltin ? 1 : 0,
        is_orchestrator: a.isOrchestrator ? 1 : 0,
        supports_vision: a.supportsVision ? 1 : 0,
        created_at: a.createdAt,
      })
    }
  })

  tx(BUILTIN_AGENTS)
}

function upgradeBuiltinAgents(sqlite: Database.Database): void {
  const rows = sqlite
    .prepare('SELECT id, tool_names, system_prompt FROM agents WHERE is_builtin = 1')
    .all() as { id: string; tool_names: string; system_prompt: string }[]

  const update = sqlite.prepare(
    'UPDATE agents SET tool_names = ?, system_prompt = ? WHERE id = ? AND is_builtin = 1',
  )

  for (const row of rows) {
    let changed = false
    let toolNames: string[]
    try {
      const parsed = JSON.parse(row.tool_names) as unknown
      toolNames = Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      toolNames = []
    }

    for (const toolName of BUILTIN_TOOL_UPGRADES.get(row.id) ?? []) {
      if (toolNames.includes(toolName)) continue
      if (toolName === 'deploy_artifact') {
        const insertAfter = toolNames.indexOf('write_artifact')
        if (insertAfter >= 0) toolNames.splice(insertAfter + 1, 0, toolName)
        else toolNames.push(toolName)
      } else {
        toolNames.push(toolName)
      }
      changed = true
    }

    let systemPrompt = row.system_prompt
    if (row.id === 'ag_frontend' && !systemPrompt.includes('deploy_artifact')) {
      systemPrompt +=
        '\n\n完成 web_app 产物后必须调用 deploy_artifact，让用户在消息里拿到部署状态卡和可打开的本地预览路径。'
      changed = true
    }
    if (
      row.id === 'ag_frontend' &&
      !systemPrompt.includes('不要在文字总结里把它改写成公网域名')
    ) {
      systemPrompt += `\n\n${FRONTEND_DEPLOYMENT_PROMPT_HINT}`
      changed = true
    }
    if (
      row.id === 'ag_frontend' &&
      (!systemPrompt.includes('不要用 write_artifact 代替应该落盘的源码') ||
        !systemPrompt.includes('deploy_workspace'))
    ) {
      systemPrompt += `\n\n${FRONTEND_LOCAL_WORKSPACE_PROMPT_HINT}`
      changed = true
    }
    if (row.id === 'ag_reviewer' && !systemPrompt.includes('本地代码审查先用 fs_read')) {
      systemPrompt += `\n\n${REVIEWER_LOCAL_WORKSPACE_PROMPT_HINT}`
      changed = true
    }
    if (row.id === 'ag_designer' && !systemPrompt.includes('禁止 write_artifact({})')) {
      systemPrompt += `\n\n${UI_DESIGNER_ARTIFACT_PROMPT_HINT}`
      changed = true
    }

    if (changed) update.run(JSON.stringify(toolNames), systemPrompt, row.id)
  }
}

export function bootstrapDatabase(sqlite: Database.Database): void {
  ensureSchema(sqlite)
  ensureBuiltinAgents(sqlite)
  upgradeBuiltinAgents(sqlite)
}
