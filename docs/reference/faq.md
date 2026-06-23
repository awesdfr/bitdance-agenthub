# FAQ

| Question | Short answer | Related control |
| --- | --- | --- |
| 数据安全吗? | Local storage, secret references, and key encryption policies are the default direction. | `secret_vault` |
| 删错文件怎么办? | Destructive file actions should be bounded by sandbox checks and approvals. | `sandbox_policies` |
| 支持本地模型吗? | Ollama-style local model profiles can be configured and assigned to Agents. | `model_profiles` |
| 费用怎么算? | The app is local-first; paid usage comes from user-owned provider API keys. | `model_route_decisions` |
| 能离线使用吗? | With local models and local tools, core work can run without external providers. | `degradation_policies` |
| Mac/Linux 支持吗? | v1 is Windows-first; Mac and Linux support should follow after runtime assumptions stabilize. | `contributor_prerequisites` |
| Agent 叛变怎么办? | Sandbox policy, permissions, approvals, circuit breakers, user overrides, and ethical boundaries limit Agent behavior. | `user_overrides` |
