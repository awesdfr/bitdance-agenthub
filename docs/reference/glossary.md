# Glossary

Purpose: map user-facing terms to internal concepts.

Scope:
- Probation, warmup, degradation, conversational collaboration, confidence score, organizational learning, Meta Agent, red team, interview, retirement, anti-pattern, dead letter, takeover, interruption, circuit breaker, and drift.

## Product Vocabulary

| User-facing term | Internal term | Meaning |
| --- | --- | --- |
| 员工 / Agent | Agent Profile | 一个虚拟员工 |
| 技能 | Skill | Agent 的专业能力包 |
| 工具连接 | Tool Connection / MCP | 外部工具/服务 |
| 命令行工具 | CLI Profile | 注册的命令行 |
| 软件能力 | Software Profile | 可调用的软件 |
| 工作站 | Workstation | Agent 的独立工作环境 |
| 画布 | Canvas | 编排多个 Agent 的可视化界面 |
| 流程 | Workflow | 多个 Agent 组成的自动化流程 |
| 任务 | Task / Run | Agent 的一次执行 |
| 记忆 | Memory | Agent 学到的知识 |
| 经验 | Reflection | 任务后的学习总结 |
| 手册 | Playbook | 固化的工作流程 |
| 产物 | Artifact | Agent 的输出成果 |
| 审批 | Approval | 需要用户确认的操作 |
| 接管 | Takeover | 用户接手 Agent 的操作 |
| 黑板 | Blackboard | 多个 Agent 共享的信息空间 |
| 熔断 | Circuit Breaker | 自动紧急停止 |
| 回滚 | Rollback | 撤销 Agent 的操作 |
| 休眠 | Hibernate | Agent 释放内存但不丢失状态 |
| 死信 | Dead Letter | 反复失败的废弃任务 |

| User term | Internal term | Category | Related entity |
| --- | --- | --- | --- |
| 试用期 | probation | lifecycle | `agent_profiles` |
| 预热 | warmup | lifecycle | `employee_runs` |
| 降级 | degradation | runtime | `degradation_events` |
| 对话式协作 | conversational_collaboration | collaboration | `inter_agent_messages` |
| 信心评分 | confidence_score | quality | `artifact_validations` |
| 组织学习 | organizational_learning | learning | `organizational_knowledge_items` |
| 元Agent | meta_agent | operations | `meta_agent_profiles` |
| 红队 | red_team | safety | `security_findings` |
| 面试 | interview | quality | `agent_interviews` |
| 退役 | retirement | lifecycle | `agent_retirement_plans` |
| 反模式 | anti_pattern | quality | `prompt_anti_pattern_rules` |
| 死信 | dead_letter | runtime | `task_queue_items` |
| 接管 | takeover | operations | `user_overrides` |
| 插话 | interruption | collaboration | `user_overrides` |
| 熔断 | circuit_breaker | safety | `abuse_detection_events` |
| 漂移 | drift | quality | `benchmark_runs` |
