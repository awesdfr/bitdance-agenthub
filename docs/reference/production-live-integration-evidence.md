# 生产级现场集成证据

这份文档记录真实本机环境里的集成测试结果。它用于区分“系统能力已经实现”和“现场环境还缺少授权、驱动、设备或生产门禁”的情况。

## DeepSeek 模型出口

- Base URL: `https://api.deepseek.com`
- 模型配置名称：`DeepSeek OpenAI Live`
- 模型配置 ID：`mp_Dwv52Z7hR8Ez`
- 密钥处理：通过 `DEEPSEEK_API_KEY` 注入测试，密钥不写入仓库和文档。
- 连接测试结果：`ok`
- 端点响应：真实模型端点已成功响应。
- 延迟：约 `1190ms` 到 `1302ms`
- 最小推理测试状态：
  - 未开启真实推理开关时，系统按预期拦截：`AGENTHUB_ENABLE_REAL_MODEL_INVOCATION is not set to 1.`
  - 开启真实推理开关后，系统继续按预期要求 go-live 审批哈希：`Live model invocation requires AGENTHUB_APPROVED_GO_LIVE_DECISION_HASH to match the latest approved go-live decision.`
- 结论：DeepSeek 账号、密钥和 OpenAI 兼容连接已经可用；真实推理当前卡在产品内置的生产上线门禁，不是密钥或网络问题。

## SkillsMap

- Marketplace URL: `https://skillsmp.com/`
- Smoke 脚本：`scripts/smoke-skillsmap-integration-api.ts`
- Readiness：`ready`
- Readiness score：`98`
- 集成行为：Skills Center 区分本地已安装 Skills 和内嵌 marketplace 浏览区；如果目标站点禁止 iframe 内嵌，界面会提供外部打开兜底入口。

## 剪映专业版 CLI

- 本地应用：`D:\JianyingPro\JianyingPro.exe`
- 检测版本：`10.6.0.14057`
- 生成 CLI：`cli-anything-jianying`
- 已安装命令：`C:\Users\九思\AppData\Local\Programs\Python\Python312\Scripts\cli-anything-jianying.exe`
- AgentHub CLI Profile：`剪映专业版 CLI`
- AgentHub Software Profile：`剪映专业版`
- PATH 状态：当前 PowerShell 里裸命令 `cli-anything-jianying` 不在 PATH；AgentHub Profile 使用绝对路径调用，不受此影响。
- 注册命令：
  - `定位剪映`
  - `查看剪映状态`
  - `启动剪映`
  - `截图剪映主窗口`
  - `列出剪映草稿目录`
- 源码模式 pytest：`10 passed`
- 已安装命令 pytest：`10 passed`
- 真实桌面截图：`tmp\jianying-live-smoke.png`
- 截图验证：
  - 尺寸：`1168x780`
  - 文件大小：`326371`
  - RGB 通道 extrema：所有通道均达到 `0..255`
  - 结果：真实桌面截图非空，说明 CLI 能定位并截图剪映窗口。
- 直接命令复测：
  - `locate` 找到 `D:\JianyingPro\JianyingPro.exe`
  - `status` 显示剪映正在运行，发现 `10` 个相关进程、`18` 个候选窗口、`4` 个本地草稿。
  - 当前可见窗口包含 `剪映专业版` 主窗口和 `版本更新` 弹窗。
- 当前边界：已经具备安全预检和桌面状态能力；完整导入、剪辑、导出还需要继续做剪映宏录制或草稿格式适配器。

## 微信桌面版 CLI

- 本地应用：`D:\微信\Weixin\Weixin.exe`
- 现有 CLI：`C:\Users\九思\AppData\Local\Programs\Python\Python312\Scripts\cli-anything-wechat.exe`
- AgentHub CLI Profile：`微信桌面版 CLI`
- AgentHub Software Profile：`微信桌面版`
- 注册命令：
  - `定位微信`，风险等级 `low`，无需审批。
  - `查看微信状态`，风险等级 `low`，无需审批。
  - `聚焦微信窗口`，风险等级 `medium`，无需审批。
  - `截图微信窗口`，风险等级 `high`，需要审批。
  - `读取微信可见文字`，风险等级 `high`，需要审批。
  - `起草当前聊天消息`，风险等级 `high`，需要审批。
- 真实状态：
  - 微信可执行文件已找到。
  - 微信进程正在运行。
  - 微信窗口可以枚举。
- 真实截图：
  - 路径：`tmp\wechat-live-smoke-restored.png`
  - 尺寸：`296x388`
  - RGB 通道 extrema：所有通道均达到 `0..255`
  - 结果：真实桌面截图非空。
- 可见文字读取：
  - Windows UI Automation 能读取当前微信入口窗口的可见控件文本。
  - CLI 没有读取聊天数据库、没有解密本地存储、没有绕过登录、没有发送消息。

## Android / 手机控制

- USB 状态：用户反馈手机已通过 USB 连接。
- ADB 检查：
  - `adb` 不在 PATH 中。
  - 已检查的常见 platform-tools 路径均不存在：
    - `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
    - `%LOCALAPPDATA%\Microsoft\AndroidSDK\platform-tools\adb.exe`
    - `C:\Android\platform-tools\adb.exe`
    - `D:\Android\platform-tools\adb.exe`
    - `D:\platform-tools\adb.exe`
  - 当前 shell 中 `winget` 不可用，之前安装 Google Platform Tools 的尝试也因为网络/下载失败没有成功。
- 当前状态：真实手机自动化卡在 `adb.exe` 缺失。需要 Android platform-tools 或明确的 `adb.exe` 路径，并且手机需要开启 USB 调试、完成电脑授权、保持解锁。

## VM / RDP / 轻量工作站 Provider

- API：`POST /api/production-integrations/workstations/providers`
- Smoke 脚本：`scripts/smoke-workstation-provider-discovery-api.ts`
- Provider 数量：`7`
- 本机可发现的 Provider：
  - `rdp`
  - `hyperv`
  - `docker`
  - `wsl`
  - `vnc`
- 未检测到：
  - `virtualbox`
  - `vmware`
- RDP 证据：本机发现 `mstsc.exe`。
- Hyper-V 证据：Hyper-V PowerShell 命令检测为可用，本机发现 `vmconnect.exe`。
- 工作站启动校验：`validate_workstation` 现在会检查启动命令是否真实存在；缺少 `mstsc.exe`、`vmconnect.exe`、`VBoxManage` 或 `vmrun` 时不会再把该工作站误判为 ready。
- Docker 证据：Docker CLI 已安装，版本 `29.5.2`。
- Docker 限制：
  - `com.docker.service` 当前是 `Stopped`。
  - 尝试启动服务失败，当前进程无法打开该服务。
  - Docker daemon 当前不可达，命名管道访问被拒绝。
- WSL 证据：本机发现 `wsl.exe`，`WSLService` 正在运行。
- WSL 限制：当前没有注册 Linux 发行版，所以还不能作为真实隔离工作站使用。
- 当前状态：远程/虚拟工作站 provider 发现能力已经完成并通过 smoke；真正启动工作站还需要实际 VM/RDP/VNC 目标、allowlist、上线门禁和授权窗口。

## 剩余生产门禁

- 全量生产集成 smoke：`scripts/smoke-production-integrations-api.ts`
  - 运行结果：通过。
  - `hardeningScore`: `97`
  - `finalAcceptanceScore`: `63`
  - `finalAcceptanceCanClaimProductionReady`: `false`
  - `goLiveDecision`: `blocked`
  - 结论：代码侧生产硬化已经很高，但当前现场环境还不能声称“可直接生产上线”。
- 真实手机控制需要 `adb.exe`、USB 调试授权和解锁测试机。
- 微信默认只注册安全预检、可见窗口和起草能力；真实自动发送消息没有作为默认命令开放。
- 剪映完整导入、剪辑、导出自动化还需要继续做宏录制或草稿格式适配器。
- Docker 工作站需要 Docker Desktop Service 正常运行并允许当前用户访问 daemon。
- WSL 工作站需要先安装一个 Linux 发行版。
- VM/RDP/VNC 工作站需要真实目标机器或远程会话配置；当前本机 RDP/Hyper-V 命令可用，VirtualBox/VMware 命令未发现。
- DeepSeek 真实推理已经通过连接验证，但正式推理调用需要满足产品 go-live 审批门禁。
