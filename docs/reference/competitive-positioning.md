# Competitive Positioning

Section 114 is implemented as a persisted positioning report, not as live web research.

## Similar Products

| Product type | Limitation captured in the plan | Design response |
| --- | --- | --- |
| AutoGPT / BabyAGI | 单 Agent，无编排，无记忆系统，无桌面操作 | Multi-Agent employee factory with orchestration, memory, and computer operation. |
| LangChain / CrewAI | 开发框架，需要写代码，非产品 | Product UI, templates, approvals, and local control plane. |
| Microsoft Copilot | 嵌入 Office，不能创建自定义 Agent | User-created configurable Agents across models, Skills, tools, memory, and permissions. |
| Claude Code / Codex CLI | 代码专用，不能操作桌面软件 | Coding CLIs become one callable capability inside the broader orchestrator. |
| Browser-use / Playwright | 浏览器专用，不能编排多 Agent | Browser automation is one workstation adapter, not the whole product. |

## Differentiation

1. 多 Agent 编排
2. 本地优先
3. 完整的员工模型
4. 软件 CLI 化
5. 隔离工作站
6. 长期记忆和学习
7. Canvas 可视化编排

## APIs

- `POST /api/competitive-positioning/seed`
- `GET /api/competitive-positioning/reports`
- `POST /api/competitive-positioning/reports`

## Boundary

The default report is a product strategy artifact based on the implementation plan. It does not claim to be a live competitive-intelligence feed.
