import { chromium, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const uiText = {
  productionNav: '\u4ea4\u4ed8\u68c0\u67e5',
  settingsButton: 'API \u8bbe\u7f6e',
  settingsTitle: '\u8bbe\u7f6e',
  settingsKeysTab: '\u4f9b\u5e94\u5546 Key',
  mobileTab: '\u79fb\u52a8\u7aef',
  productionTitle: '\u4ea4\u4ed8\u68c0\u67e5',
  productionScore: '\u4ea4\u4ed8\u51c6\u5907\u5ea6',
  productionActions: '\u4ea4\u4ed8\u6d41\u7a0b',
  generateGoLive: '\u751f\u6210\u4ea4\u4ed8\u5224\u5b9a',
  generateLivePilot: '\u751f\u6210\u8bd5\u8fd0\u884c\u51ed\u8bc1',
  startLivePilot: '\u5f00\u59cb\u8bd5\u8fd0\u884c',
  exportActivation: '\u5bfc\u51fa\u73b0\u573a\u6fc0\u6d3b\u5305',
  exportCustomer: '\u5bfc\u51fa\u5ba2\u6237\u73af\u5883\u5305',
  deliveryStep: '\u68c0\u67e5\u57fa\u7840\u80fd\u529b',
  mobileCheck: '\u68c0\u67e5\u624b\u673a\u8fde\u63a5',
  conversationNav: '\u5bf9\u8bdd',
  newConversation: '\u65b0\u5efa\u5bf9\u8bdd',
  workArea: '\u5de5\u4f5c\u5bf9\u8bdd\u533a',
  modelPicker: '\u9009\u62e9\u6a21\u578b',
  chatInput: '\u8f93\u5165\u6d88\u606f',
  modelConversationCopy: '\u5355\u72ec\u7684\u666e\u901a\u804a\u5929\u7a97\u53e3',
  workAreaCopy: '\u591a\u667a\u80fd\u4f53\u534f\u4f5c',
  workspaceDirectory: '\u5de5\u4f5c\u76ee\u5f55',

  modelsNav: '\u6a21\u578b\u7ba1\u7406',
  modelsTitle: '\u6a21\u578b\u7ba1\u7406',
  addModel: '\u6dfb\u52a0\u6a21\u578b',
  saveModel: '\u4fdd\u5b58\u6a21\u578b',
  deleteModel: '\u5220\u9664\u6a21\u578b',
  confirmDeleteModel: '\u786e\u8ba4\u5220\u9664\u6a21\u578b',
  modelNamePlaceholder: '\u4f8b\u5982\uff1aDeepSeek \u4e3b\u6a21\u578b',
  modelIdPlaceholder: '\u4f8b\u5982\uff1adeepseek-v4-flash',

  agentsNav: '\u667a\u80fd\u4f53',
  oldFactoryNav: '\u667a\u80fd\u4f53\u5de5\u5382',
  createAgent: '\u521b\u5efa\u667a\u80fd\u4f53',
  agentSettingsButtonTitle: '\u8bbe\u7f6e\u667a\u80fd\u4f53',
  agentAbilityTab: '\u667a\u80fd\u4f53\u80fd\u529b',
  agentIdentitySection: '\u8eab\u4efd\u4e0e\u4ea7\u7269',
  agentMemoryContextSection: '\u8bb0\u5fc6\u3001\u4e0a\u4e0b\u6587\u4e0e\u534f\u4f5c',
  agentSecuritySection: '\u5b89\u5168\u6743\u9650\u4e0e\u81ea\u4e3b\u6027',
  saveCurrentAgent: '\u4fdd\u5b58\u5f53\u524d\u8bbe\u7f6e',
  newAgentProfile: '\u65b0\u5efa\u914d\u7f6e',
  detailedConfig: '\u8be6\u7ec6\u914d\u7f6e',
  abilityPromptTab: '\u80fd\u529b\u4e0e\u63d0\u793a\u8bcd',
  installedSkills: '\u5df2\u5b89\u88c5 Skills',
  mcpTools: 'MCP \u5de5\u5177',
  cliCommands: 'CLI \u547d\u4ee4',

  toolsNav: '\u5de5\u5177\u8fde\u63a5',
  toolsTitle: '\u8f6f\u4ef6\u80fd\u529b\u5546\u5e97',
  advancedTools: '\u9ad8\u7ea7\u914d\u7f6e',
  toolsSearchPlaceholder: '\u641c\u7d22\u8f6f\u4ef6\u3001CLI\u3001MCP',
  toolsCategory: '\u5f00\u53d1\u5de5\u5177',
  toolsSoftwareCard: 'Codex CLI',
  toolsModeStat: 'CLI / MCP \u6a21\u5f0f',
  toolsIntro: '\u8f6f\u4ef6\u4ecb\u7ecd',
  toolsCliAccess: 'CLI \u63a5\u5165',
  toolsMcpAccess: 'MCP \u63a5\u5165',

  skillsNav: '\u6280\u80fd\u4e2d\u5fc3',
  skillsMarket: 'SkillsMP \u6280\u80fd\u5e02\u573a',
  skillsCli: 'SkillsMP CLI',
  skillsSearchPlaceholder: '\u641c\u7d22\u6280\u80fd\uff0c\u6bd4\u5982\uff1a\u5199\u4ee3\u7801\u3001\u8fd0\u8425\u3001\u6d4f\u89c8\u5668\u3001\u89c6\u9891',
  skillsSmokeResult: 'smoke-research-plus',

  canvasNav: '\u7f16\u6392\u753b\u5e03',
  canvasTitle: '\u667a\u80fd\u4f53\u7f16\u6392\u753b\u5e03',
  addAgent: '\u6dfb\u52a0\u667a\u80fd\u4f53',
  inlineEditor: '\u753b\u5e03\u5185\u7f16\u8f91',
  nodeName: '\u8282\u70b9\u540d\u79f0',
  customerDeliverables: '\u5ba2\u6237\u4ea4\u4ed8\u7269',
  customerVisible: '\u5ba2\u6237\u53ef\u89c1',
  videoArtifact: '\u89c6\u9891',
  advancedSettings: '\u9ad8\u7ea7\u8bbe\u7f6e',
  runMonitor: '\u8fd0\u884c\u4e0e\u76d1\u63a7',
  analyticsNav: '\u6570\u636e\u5206\u6790',
  analyticsTitle: '\u7528\u91cf\u5206\u6790',
  modelActualUsage: '\u6a21\u578b\u5b9e\u9645\u6d88\u8017',
  contextWindow: '\u4e0a\u4e0b\u6587\u7a97\u53e3',
  runtimeMetrics: '\u8fd0\u884c\u6307\u6807',
  costTitle: '\u6210\u672c',
  sessionStatus: '\u4f1a\u8bdd\u72b6\u6001',
  projectContext: '\u5de5\u7a0b\u6587\u4ef6\u4e0a\u4e0b\u6587',
  moreFeatures: '\u66f4\u591a\u529f\u80fd',
  hiddenAdvancedNav: [
    '\u8bb0\u5fc6\u5b66\u4e60',
    '\u4e0a\u4e0b\u6587',
    '\u80fd\u529b\u56fe\u8c31',
    '\u56e2\u961f\u534f\u4f5c',
    '\u5b89\u5168\u6cbb\u7406',
    '\u914d\u7f6e\u7ba1\u7406',
  ],
}

async function main() {
  const baseUrl = process.env.AGENTHUB_UI_URL ?? 'http://127.0.0.1:3101'
  const outDir = path.resolve('output/playwright')
  mkdirSync(outDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const consoleErrors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.getByText('AgentHub').first().waitFor({ timeout: 90_000 })
  await page.waitForTimeout(2_000)
  await cleanupSmokeModels(page, baseUrl)

  await page.locator(`aside button[title="${uiText.settingsButton}"]`).click()
  const settingsDialog = page.locator('[role="dialog"]').filter({ hasText: uiText.settingsTitle }).first()
  await settingsDialog.getByText(uiText.settingsKeysTab, { exact: true }).waitFor({ timeout: 30_000 })
  const settingsDialogText = await settingsDialog.innerText()
  const settingsChecks = {
    keysVisible: settingsDialogText.includes(uiText.settingsKeysTab),
    mobileHiddenForNow: !settingsDialogText.includes(uiText.mobileTab),
  }
  for (const [key, value] of Object.entries(settingsChecks)) {
    if (!value) throw new Error(`Settings simplification check failed: ${key}.`)
  }
  await settingsDialog.getByRole('button', { name: '\u53d6\u6d88' }).click()
  await settingsDialog.waitFor({ state: 'hidden', timeout: 10_000 })

  await page.getByRole('button', { name: uiText.newConversation }).click()
  await page.locator(`textarea[placeholder*="${uiText.chatInput}"]`).waitFor({ timeout: 90_000 })
  const modelPickerDialogCount = await page
    .locator('[role="dialog"]')
    .getByText(uiText.modelPicker, { exact: true })
    .count()
  if (modelPickerDialogCount > 0) {
    throw new Error('New conversation should jump directly into chat without model picker dialog.')
  }
  const directConversationScreenshot = path.join(outDir, 'new-conversation-direct-chat.png')
  await page.screenshot({ path: directConversationScreenshot, fullPage: true })
  const directConversationChecks = {
    chatInputVisible: await page.locator(`textarea[placeholder*="${uiText.chatInput}"]`).isVisible(),
    noModelPickerDialog: modelPickerDialogCount === 0,
  }
  for (const [key, value] of Object.entries(directConversationChecks)) {
    if (!value) throw new Error(`Direct new conversation check failed: ${key}.`)
  }

  const smokeModelName = `UI \u4e34\u65f6\u6a21\u578b ${Date.now()}`
  await page.locator('aside button', { hasText: uiText.modelsNav }).click({ force: true })
  await page.locator('main').getByText(uiText.modelsTitle, { exact: true }).waitFor({ timeout: 90_000 })
  await page.locator('main button', { hasText: uiText.addModel }).first().click()
  const modelDialog = page.locator('[role="dialog"]').filter({ hasText: uiText.addModel }).first()
  await modelDialog.getByText(uiText.addModel, { exact: true }).waitFor({ timeout: 90_000 })
  await modelDialog.getByPlaceholder(uiText.modelNamePlaceholder).fill(smokeModelName)
  await modelDialog.getByPlaceholder(uiText.modelIdPlaceholder).fill('deepseek-v4-flash')
  await modelDialog.getByRole('button', { name: uiText.saveModel }).click()
  await modelDialog.waitFor({ state: 'hidden', timeout: 30_000 })
  const smokeModelCard = page.getByTestId('model-profile-card').filter({ hasText: smokeModelName }).first()
  await smokeModelCard.waitFor({ timeout: 90_000 })
  await smokeModelCard.getByRole('button', { name: `${uiText.deleteModel} ${smokeModelName}` }).click()
  await smokeModelCard.getByRole('button', { name: `${uiText.confirmDeleteModel} ${smokeModelName}` }).click()
  await smokeModelCard.waitFor({ state: 'hidden', timeout: 90_000 })
  const modelManagementScreenshot = path.join(outDir, 'model-management-add-delete.png')
  await page.screenshot({ path: modelManagementScreenshot, fullPage: true })
  const modelManagementChecks = {
    title: await page.locator('main').getByText(uiText.modelsTitle, { exact: true }).isVisible(),
    addButton: await page.locator('main button', { hasText: uiText.addModel }).first().isVisible(),
    temporaryModelDeleted:
      (await page.getByTestId('model-profile-card').filter({ hasText: smokeModelName }).count()) === 0,
  }
  for (const [key, value] of Object.entries(modelManagementChecks)) {
    if (!value) throw new Error(`Model management UI check failed: ${key}.`)
  }

  await page.locator('aside button', { hasText: uiText.conversationNav }).click({ force: true })
  await page.getByRole('button', { name: uiText.workArea }).click()
  const dialog = page.locator('[role="dialog"]')
  await dialog.getByText(uiText.workAreaCopy).waitFor({ timeout: 90_000 })
  await dialog.getByText(uiText.workspaceDirectory, { exact: true }).waitFor({ timeout: 90_000 })
  await dialog.getByRole('button', { name: '\u53d6\u6d88' }).click()
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 })

  await page.locator(`aside button[title="${uiText.agentsNav}"]`).click({ force: true })
  await page.getByText(uiText.createAgent, { exact: true }).waitFor({ timeout: 90_000 })
  const oldFactoryNavCount = await page.locator(`aside button[title="${uiText.oldFactoryNav}"]`).count()
  const settingsButtons = page.locator(`main button[title="${uiText.agentSettingsButtonTitle}"]`)
  const firstSettingsButton = settingsButtons.first()
  await firstSettingsButton.waitFor({ timeout: 90_000 })
  await firstSettingsButton.click()
  await page.getByText(uiText.agentAbilityTab, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByText(uiText.agentIdentitySection, { exact: true }).waitFor({ timeout: 120_000 })
  await page.getByText(uiText.agentMemoryContextSection, { exact: true }).waitFor({ timeout: 120_000 })
  await page.getByText(uiText.agentSecuritySection, { exact: true }).waitFor({ timeout: 120_000 })
  const moreButton = page.locator('aside button', { hasText: uiText.moreFeatures })
  if ((await moreButton.count()) > 0) await moreButton.first().click({ force: true })
  const sidebarText = await page.locator('aside').innerText()
  const agentScreenshot = path.join(outDir, 'agents-unified-settings.png')
  await page.screenshot({ path: agentScreenshot, fullPage: true })
  const agentBodyText = await page.locator('body').innerText()
  const agentChecks = {
    singleAgentEntry: agentBodyText.includes(uiText.createAgent),
    oldFactoryNavHidden: oldFactoryNavCount === 0,
    settingsGear: (await settingsButtons.count()) > 0,
    settingsPanel: agentBodyText.includes(uiText.agentAbilityTab),
    saveOrCreateProfile:
      agentBodyText.includes(uiText.saveCurrentAgent) || agentBodyText.includes(uiText.newAgentProfile),
    memoryContextInAgentSettings: agentBodyText.includes(uiText.agentMemoryContextSection),
    securityInAgentSettings: agentBodyText.includes(uiText.agentSecuritySection),
    advancedNavHidden: uiText.hiddenAdvancedNav.every((label) => !sidebarText.includes(label)),
  }
  for (const [key, value] of Object.entries(agentChecks)) {
    if (!value) throw new Error(`Agent unified settings UI check failed: ${key}.`)
  }

  await page.locator('main button', { hasText: uiText.createAgent }).first().click()
  await page.getByText(uiText.detailedConfig, { exact: true }).click()
  await page.getByText(uiText.abilityPromptTab, { exact: true }).click()
  await page.getByText(uiText.installedSkills, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByText(uiText.mcpTools, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByText(uiText.cliCommands, { exact: true }).waitFor({ timeout: 90_000 })
  const agentCreateCapabilitiesScreenshot = path.join(outDir, 'agent-create-capability-picker.png')
  await page.screenshot({ path: agentCreateCapabilitiesScreenshot, fullPage: true })
  const createDialogText = await page.locator('[role="dialog"]').innerText()
  const createDialogChecks = {
    tab: createDialogText.includes(uiText.abilityPromptTab),
    skills: createDialogText.includes(uiText.installedSkills),
    mcp: createDialogText.includes(uiText.mcpTools),
    cli: createDialogText.includes(uiText.cliCommands),
    noOldToolset: !createDialogText.includes('\u5de5\u5177\u96c6'),
  }
  for (const [key, value] of Object.entries(createDialogChecks)) {
    if (!value) throw new Error(`Create Agent capability picker check failed: ${key}.`)
  }
  await page.locator('[role="dialog"]').getByRole('button', { name: '\u53d6\u6d88' }).click()
  await page.locator('[role="dialog"]').waitFor({ state: 'hidden', timeout: 10_000 })

  await page.locator(`aside button[title="${uiText.productionNav}"]`).click({ force: true })
  await page.locator('main').getByText(uiText.productionTitle, { exact: true }).waitFor({ timeout: 120_000 })
  const productionScreenshot = path.join(outDir, 'production-simple-workbench.png')
  await page.screenshot({ path: productionScreenshot, fullPage: true })
  const productionBodyText = await page.locator('body').innerText()
  const productionChecks = {
    title: productionBodyText.includes(uiText.productionTitle),
    score: productionBodyText.includes(uiText.productionScore),
    actions: productionBodyText.includes(uiText.productionActions),
    generateGoLive: productionBodyText.includes(uiText.generateGoLive),
    generateLivePilot: productionBodyText.includes(uiText.generateLivePilot),
    startLivePilot: productionBodyText.includes(uiText.startLivePilot),
    exportActivation: productionBodyText.includes(uiText.exportActivation),
    exportCustomer: productionBodyText.includes(uiText.exportCustomer),
    deliveryStep: productionBodyText.includes(uiText.deliveryStep),
    mobileHiddenForNow: !productionBodyText.includes(uiText.mobileCheck),
  }
  for (const [key, value] of Object.entries(productionChecks)) {
    if (!value) throw new Error(`Production UI check failed: ${key}.`)
  }

  await page.locator('aside button', { hasText: uiText.toolsNav }).click({ force: true })
  await page.getByText(uiText.toolsTitle).waitFor({ timeout: 90_000 })
  await page.getByTestId('software-store-card-codex-cli').click()
  await page.getByTestId('software-store-detail').getByText(uiText.toolsIntro, { exact: true }).waitFor({
    timeout: 90_000,
  })
  const toolsScreenshot = path.join(outDir, 'tools-simple-workbench.png')
  await page.screenshot({ path: toolsScreenshot, fullPage: true })
  const toolsBodyText = await page.locator('body').innerText()
  const toolsChecks = {
    title: toolsBodyText.includes(uiText.toolsTitle),
    advancedButton: toolsBodyText.includes(uiText.advancedTools),
    searchInput: await page.getByPlaceholder(uiText.toolsSearchPlaceholder).isVisible(),
    category: toolsBodyText.includes(uiText.toolsCategory),
    softwareCard: toolsBodyText.includes(uiText.toolsSoftwareCard),
    modeStat: toolsBodyText.includes(uiText.toolsModeStat),
    intro: toolsBodyText.includes(uiText.toolsIntro),
    cliAccess: toolsBodyText.includes(uiText.toolsCliAccess),
    mcpAccess: toolsBodyText.includes(uiText.toolsMcpAccess),
  }
  for (const [key, value] of Object.entries(toolsChecks)) {
    if (!value) throw new Error(`Tools UI check failed: ${key}.`)
  }

  await page.route('**/api/skills/skillsmp-cli', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: {
          ok: true,
          cli: 'skillsmp',
          command: 'search',
          source: 'fixture',
          baseUrl: 'https://skillsmp.com',
          query: 'code review',
          page: 1,
          limit: 12,
          sortBy: 'recent',
          category: null,
          occupation: null,
          total: 1,
          rateLimit: null,
          items: [
            {
              id: 'smoke-research-plus',
              name: 'smoke-research-plus',
              description: 'Smoke SkillsMP result for UI rendering.',
              repository: 'example/smoke-research-plus',
              creator: 'smoke',
              sourceUrl: 'https://github.com/example/smoke-research-plus',
              skillUrl: 'https://skillsmp.com/skills/smoke-research-plus',
              stars: 42,
              downloads: 128,
              category: 'research',
              occupation: 'operator',
              updatedAt: null,
              tags: ['web_research', 'source_summarization'],
              manifest: { name: 'smoke-research-plus' },
            },
          ],
        },
      }),
    })
  })
  await page.locator('aside button', { hasText: uiText.skillsNav }).click({ force: true })
  await page.getByText(uiText.skillsMarket, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByPlaceholder(uiText.skillsSearchPlaceholder).waitFor({ timeout: 90_000 })
  await page.locator('main button', { hasText: '\u641c\u7d22' }).click()
  await page.getByText(uiText.skillsSmokeResult, { exact: true }).waitFor({ timeout: 90_000 })
  const skillsScreenshot = path.join(outDir, 'skillsmp-cli-market.png')
  await page.screenshot({ path: skillsScreenshot, fullPage: true })
  const skillsBodyText = await page.locator('body').innerText()
  const skillsChecks = {
    title: skillsBodyText.includes(uiText.skillsMarket),
    cliBadge: skillsBodyText.includes(uiText.skillsCli),
    searchInput: await page.getByPlaceholder(uiText.skillsSearchPlaceholder).isVisible(),
    resultCard: skillsBodyText.includes(uiText.skillsSmokeResult),
  }
  for (const [key, value] of Object.entries(skillsChecks)) {
    if (!value) throw new Error(`SkillsMP UI check failed: ${key}.`)
  }

  await page.locator('aside button', { hasText: uiText.canvasNav }).click({ force: true })
  await page.getByText(uiText.canvasTitle, { exact: true }).waitFor({ timeout: 90_000 })
  const inlineEditorAlreadyVisible = await page
    .getByText(uiText.inlineEditor, { exact: true })
    .isVisible()
    .catch(() => false)
  if (!inlineEditorAlreadyVisible) {
    const addAgentInMain = page.locator('main button', { hasText: uiText.addAgent })
    if ((await addAgentInMain.count()) > 0) {
      await addAgentInMain.first().click()
    }
  }
  await page.getByText(uiText.inlineEditor, { exact: true }).waitFor({ timeout: 30_000 })
  const quickEditor = page.getByTestId('canvas-quick-editor')
  await quickEditor.waitFor({ timeout: 30_000 })
  await quickEditor.locator('select').nth(1).selectOption('video')
  await page.getByTestId('canvas-customer-delivery-dock').getByText(uiText.videoArtifact).first().waitFor({
    timeout: 30_000,
  })

  const firstNode = page.locator('main [role="button"]', { hasText: '\u667a\u80fd\u4f53\u8282\u70b9' }).first()
  const beforePan = await firstNode.boundingBox()
  const canvasSurface = page.getByTestId('workflow-canvas-surface')
  const canvasBox = await canvasSurface.boundingBox()
  if (!beforePan || !canvasBox) throw new Error('Canvas UI check failed: panSetup.')
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + canvasBox.height * 0.72)
  await page.mouse.down()
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.52 + 120, canvasBox.y + canvasBox.height * 0.72 + 60, {
    steps: 8,
  })
  await page.mouse.up()
  const afterPan = await firstNode.boundingBox()
  const canvasPan =
    !!afterPan &&
    Math.abs(afterPan.x - beforePan.x) >= 80 &&
    Math.abs(afterPan.y - beforePan.y) >= 35

  let runPanelVisible = await page.getByText(uiText.runMonitor).isVisible().catch(() => false)
  if (!runPanelVisible) {
    await page.locator('main button', { hasText: uiText.advancedSettings }).first().click()
    runPanelVisible = await page.getByText(uiText.runMonitor).isVisible().catch(() => false)
  }

  const canvasScreenshot = path.join(outDir, 'canvas-inline-editor.png')
  await page.screenshot({ path: canvasScreenshot, fullPage: true })
  const canvasChecks = {
    canvasTitle: await page.getByText(uiText.canvasTitle, { exact: true }).isVisible(),
    inlineEditor: await page.getByText(uiText.inlineEditor, { exact: true }).isVisible(),
    nodeNameInput: await page.getByPlaceholder(uiText.nodeName).isVisible(),
    customerDeliverableDock: await page.getByTestId('canvas-customer-delivery-dock').isVisible(),
    customerDeliverablesPanel: await page.getByTestId('canvas-customer-deliverables-panel').isVisible(),
    customerVisible: (await page.locator('main').innerText()).includes(uiText.customerVisible),
    videoArtifact: (await page.locator('main').innerText()).includes(uiText.videoArtifact),
    backgroundPan: canvasPan,
    runPanel: runPanelVisible,
  }
  for (const [key, value] of Object.entries(canvasChecks)) {
    if (!value) throw new Error(`Canvas UI check failed: ${key}.`)
  }

  const analyticsNav = page.locator('aside button', { hasText: uiText.analyticsNav })
  if ((await analyticsNav.count()) === 0) {
    const collapsedMore = page.locator('aside button', { hasText: uiText.moreFeatures })
    if ((await collapsedMore.count()) > 0) await collapsedMore.first().click({ force: true })
  }
  await page.locator('aside button', { hasText: uiText.analyticsNav }).click({ force: true })
  await page.getByText(uiText.analyticsTitle, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByText(uiText.modelActualUsage, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByText(uiText.contextWindow, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByText(uiText.runtimeMetrics, { exact: true }).waitFor({ timeout: 90_000 })
  await page.getByText(uiText.projectContext, { exact: true }).waitFor({ timeout: 90_000 })
  const analyticsScreenshot = path.join(outDir, 'usage-context-dashboard.png')
  await page.screenshot({ path: analyticsScreenshot, fullPage: true })
  const analyticsBodyText = await page.locator('body').innerText()
  const analyticsChecks = {
    title: analyticsBodyText.includes(uiText.analyticsTitle),
    modelActualUsage: analyticsBodyText.includes(uiText.modelActualUsage),
    contextWindow: analyticsBodyText.includes(uiText.contextWindow),
    runtimeMetrics: analyticsBodyText.includes(uiText.runtimeMetrics),
    cost: analyticsBodyText.includes(uiText.costTitle),
    sessionStatus: analyticsBodyText.includes(uiText.sessionStatus),
    projectContext: analyticsBodyText.includes(uiText.projectContext),
    modelCache: analyticsBodyText.includes('\u7f13\u5b58\u547d\u4e2d'),
    modelCost: analyticsBodyText.includes('\u8d39\u7528'),
    lazyProjectFiles: analyticsBodyText.includes('\u6309\u9700'),
  }
  for (const [key, value] of Object.entries(analyticsChecks)) {
    if (!value) throw new Error(`Usage dashboard UI check failed: ${key}.`)
  }

  await browser.close()
  console.log(JSON.stringify({
    baseUrl,
    productionChecks,
    settingsChecks,
    directConversationChecks,
    modelManagementChecks,
    createDialogChecks,
    toolsChecks,
    skillsChecks,
    canvasChecks,
    screenshots: {
      agentScreenshot,
      directConversationScreenshot,
      modelManagementScreenshot,
      agentCreateCapabilitiesScreenshot,
      productionScreenshot,
      toolsScreenshot,
      skillsScreenshot,
      canvasScreenshot,
      analyticsScreenshot,
    },
    consoleErrors: consoleErrors.slice(0, 10),
  }, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

async function cleanupSmokeModels(page: Page, baseUrl: string) {
  const response = await page.request.get(`${baseUrl}/api/model-profiles`)
  if (!response.ok()) return
  const payload = (await response.json()) as {
    modelProfiles?: Array<{ id: string; name: string }>
  }
  const smokeModels = payload.modelProfiles?.filter((model) => model.name.startsWith('UI 临时模型 ')) ?? []
  for (const model of smokeModels) {
    await page.request.delete(`${baseUrl}/api/model-profiles/${model.id}`)
  }
}
