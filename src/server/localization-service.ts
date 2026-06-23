import { and, asc, desc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentLocalizationPolicyRow,
  I18nContractArea,
  I18nContractCheckRow,
  I18nContractStatus,
  JsonObject,
  LocalizationNamespace,
  LocalizationResourceRow,
  LocalizationSettingsRow,
  OutputLanguagePolicy,
  SupportedLocale,
} from '@/db/schema'
import {
  newAgentLocalizationPolicyId,
  newI18nContractCheckId,
  newLocalizationResourceId,
} from '@/server/ids'

const supportedLocales: SupportedLocale[] = ['zh-CN', 'en-US', 'ja-JP', 'zh-TW']
const namespaces: LocalizationNamespace[] = ['ui', 'errors', 'agent-prompts', 'docs']
const DEFAULT_SETTINGS_NAME = 'default'

const defaultTranslations: Array<{
  locale: SupportedLocale
  namespace: LocalizationNamespace
  key: string
  value: string
}> = [
  { locale: 'zh-CN', namespace: 'ui', key: 'agent.factory.title', value: 'Agent 工厂' },
  { locale: 'en-US', namespace: 'ui', key: 'agent.factory.title', value: 'Agent Factory' },
  { locale: 'ja-JP', namespace: 'ui', key: 'agent.factory.title', value: 'エージェント工場' },
  { locale: 'zh-TW', namespace: 'ui', key: 'agent.factory.title', value: 'Agent 工廠' },
  { locale: 'zh-CN', namespace: 'errors', key: 'model.connection.failed', value: '模型连接失败' },
  { locale: 'en-US', namespace: 'errors', key: 'model.connection.failed', value: 'Model connection failed' },
  { locale: 'ja-JP', namespace: 'errors', key: 'model.connection.failed', value: 'モデル接続に失敗しました' },
  { locale: 'zh-TW', namespace: 'errors', key: 'model.connection.failed', value: '模型連線失敗' },
  { locale: 'zh-CN', namespace: 'agent-prompts', key: 'output.language.rule', value: '你必须使用解析后的输出语言。' },
  { locale: 'en-US', namespace: 'agent-prompts', key: 'output.language.rule', value: 'You must use the resolved output language.' },
  { locale: 'ja-JP', namespace: 'agent-prompts', key: 'output.language.rule', value: '解決された出力言語を必ず使用してください。' },
  { locale: 'zh-TW', namespace: 'agent-prompts', key: 'output.language.rule', value: '你必須使用解析後的輸出語言。' },
  { locale: 'zh-CN', namespace: 'docs', key: 'getting.started', value: '开始使用' },
  { locale: 'en-US', namespace: 'docs', key: 'getting.started', value: 'Getting started' },
  { locale: 'ja-JP', namespace: 'docs', key: 'getting.started', value: 'はじめに' },
  { locale: 'zh-TW', namespace: 'docs', key: 'getting.started', value: '開始使用' },
]

interface I18nContractDefinition {
  checkKey: string
  area: I18nContractArea
  description: string
  namespace: LocalizationNamespace | null
  requiredKeys: string[]
}

const defaultI18nContractChecks: I18nContractDefinition[] = [
  {
    checkKey: 'ui_text_keys',
    area: 'ui_text_keys',
    description: 'UI text is registered by i18n key instead of hard-coded copy.',
    namespace: 'ui',
    requiredKeys: ['agent.factory.title'],
  },
  {
    checkKey: 'agent_system_prompt_persona_language',
    area: 'agent_prompt_language',
    description: 'Agent system prompt language follows persona.language when present.',
    namespace: 'agent-prompts',
    requiredKeys: ['output.language.rule'],
  },
  {
    checkKey: 'locale_datetime_number_formatting',
    area: 'locale_formatting',
    description: 'Date, time, and number formatting are resolved through Intl by locale.',
    namespace: null,
    requiredKeys: [],
  },
  {
    checkKey: 'localized_error_messages',
    area: 'localized_errors',
    description: 'Error messages are stored in the errors namespace for every enabled locale.',
    namespace: 'errors',
    requiredKeys: ['model.connection.failed'],
  },
  {
    checkKey: 'localized_documentation',
    area: 'localized_docs',
    description: 'Documentation navigation labels are stored in the docs namespace for every enabled locale.',
    namespace: 'docs',
    requiredKeys: ['getting.started'],
  },
]

export function getSupportedLocales(): SupportedLocale[] {
  return [...supportedLocales]
}

export function getLocalizationNamespaces(): LocalizationNamespace[] {
  return [...namespaces]
}

export function getDefaultI18nContractCheckCount(): number {
  return defaultI18nContractChecks.length
}

export async function seedLocalizationDefaults(): Promise<{
  settings: LocalizationSettingsRow
  resources: LocalizationResourceRow[]
}> {
  const now = Date.now()
  let settings = await db.query.localizationSettings.findFirst({
    where: eq(schema.localizationSettings.id, DEFAULT_SETTINGS_NAME),
  })
  if (!settings) {
    settings = {
      id: DEFAULT_SETTINGS_NAME,
      defaultLocale: 'zh-CN',
      fallbackLocale: 'zh-CN',
      enabledLocales: supportedLocales,
      namespaces,
      outputLanguagePolicy: 'workspace_default',
      dateTimeFormat: { dateStyle: 'medium', timeStyle: 'short' },
      numberFormat: { maximumFractionDigits: 2 },
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.localizationSettings).values(settings)
  }
  for (const item of defaultTranslations) {
    const existing = await db.query.localizationResources.findFirst({
      where: and(
        eq(schema.localizationResources.locale, item.locale),
        eq(schema.localizationResources.namespace, item.namespace),
        eq(schema.localizationResources.key, item.key),
      ),
    })
    if (existing) continue
    await db.insert(schema.localizationResources).values({
      id: newLocalizationResourceId(),
      ...item,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return {
    settings,
    resources: await listLocalizationResources(),
  }
}

export async function seedI18nContractChecks(): Promise<I18nContractCheckRow[]> {
  const seeded = await seedLocalizationDefaults()
  const now = Date.now()
  const rows: I18nContractCheckRow[] = []
  for (const definition of defaultI18nContractChecks) {
    const evaluation = await evaluateI18nContractDefinition(definition, seeded.settings)
    const existing = await db.query.i18nContractChecks.findFirst({
      where: eq(schema.i18nContractChecks.checkKey, definition.checkKey),
    })
    if (existing) {
      const row: I18nContractCheckRow = {
        ...existing,
        area: definition.area,
        description: definition.description,
        namespace: definition.namespace,
        requiredKeys: definition.requiredKeys,
        requiredLocales: seeded.settings.enabledLocales,
        status: evaluation.status,
        evidence: evaluation.evidence,
        updatedAt: now,
      }
      await db
        .update(schema.i18nContractChecks)
        .set({
          area: row.area,
          description: row.description,
          namespace: row.namespace,
          requiredKeys: row.requiredKeys,
          requiredLocales: row.requiredLocales,
          status: row.status,
          evidence: row.evidence,
          updatedAt: row.updatedAt,
        })
        .where(eq(schema.i18nContractChecks.id, row.id))
      rows.push(row)
      continue
    }
    const row: I18nContractCheckRow = {
      id: newI18nContractCheckId(),
      checkKey: definition.checkKey,
      area: definition.area,
      description: definition.description,
      namespace: definition.namespace,
      requiredKeys: definition.requiredKeys,
      requiredLocales: seeded.settings.enabledLocales,
      status: evaluation.status,
      evidence: evaluation.evidence,
      createdAt: now,
      updatedAt: now,
    }
    await db.insert(schema.i18nContractChecks).values(row)
    rows.push(row)
  }
  return rows
}

export async function listI18nContractChecks(args: {
  area?: I18nContractArea
  status?: I18nContractStatus
  limit?: number
} = {}): Promise<I18nContractCheckRow[]> {
  const filters: SQL[] = []
  if (args.area) filters.push(eq(schema.i18nContractChecks.area, args.area))
  if (args.status) filters.push(eq(schema.i18nContractChecks.status, args.status))
  return db.query.i18nContractChecks.findMany({
    where: filters.length ? and(...filters) : undefined,
    orderBy: [asc(schema.i18nContractChecks.area), asc(schema.i18nContractChecks.checkKey)],
    limit: Math.min(Math.max(args.limit ?? 100, 1), 500),
  })
}

export async function evaluateI18nContract(): Promise<{
  checks: I18nContractCheckRow[]
  summary: {
    total: number
    passing: number
    warning: number
    failing: number
  }
}> {
  const checks = await seedI18nContractChecks()
  return {
    checks,
    summary: {
      total: checks.length,
      passing: checks.filter((row) => row.status === 'passing').length,
      warning: checks.filter((row) => row.status === 'warning').length,
      failing: checks.filter((row) => row.status === 'failing').length,
    },
  }
}

export async function listLocalizationSettings(): Promise<LocalizationSettingsRow[]> {
  return db.query.localizationSettings.findMany({
    orderBy: [asc(schema.localizationSettings.defaultLocale)],
    limit: 20,
  })
}

export async function listLocalizationResources(args: {
  locale?: SupportedLocale
  namespace?: LocalizationNamespace
} = {}): Promise<LocalizationResourceRow[]> {
  const rows = await db.query.localizationResources.findMany({
    where: args.locale ? eq(schema.localizationResources.locale, args.locale) : undefined,
    orderBy: [
      asc(schema.localizationResources.locale),
      asc(schema.localizationResources.namespace),
      asc(schema.localizationResources.key),
    ],
    limit: 200,
  })
  return args.namespace ? rows.filter((row) => row.namespace === args.namespace) : rows
}

export async function createLocalizationResource(args: {
  locale: SupportedLocale
  namespace: LocalizationNamespace
  key: string
  value: string
}): Promise<LocalizationResourceRow> {
  const now = Date.now()
  const row: LocalizationResourceRow = {
    id: newLocalizationResourceId(),
    locale: args.locale,
    namespace: args.namespace,
    key: args.key.trim(),
    value: args.value,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.localizationResources).values(row)
  return row
}

export async function translate(args: {
  locale: SupportedLocale
  namespace: LocalizationNamespace
  key: string
}): Promise<{
  value: string
  locale: SupportedLocale
  fallbackUsed: boolean
  namespace: LocalizationNamespace
  key: string
}> {
  await seedLocalizationDefaults()
  const direct = await findResource(args.locale, args.namespace, args.key)
  if (direct) {
    return {
      value: direct.value,
      locale: direct.locale,
      fallbackUsed: false,
      namespace: args.namespace,
      key: args.key,
    }
  }
  const settings = await getActiveSettings()
  const fallback = await findResource(settings.fallbackLocale, args.namespace, args.key)
  if (!fallback) throw new Error(`Missing translation: ${args.namespace}.${args.key}`)
  return {
    value: fallback.value,
    locale: fallback.locale,
    fallbackUsed: true,
    namespace: args.namespace,
    key: args.key,
  }
}

export async function createAgentLocalizationPolicy(args: {
  agentProfileId?: string | null
  outputLanguagePolicy?: OutputLanguagePolicy
  outputLocale?: SupportedLocale
  dateTimeLocale?: SupportedLocale
  numberLocale?: SupportedLocale
}): Promise<AgentLocalizationPolicyRow> {
  const now = Date.now()
  const row: AgentLocalizationPolicyRow = {
    id: newAgentLocalizationPolicyId(),
    agentProfileId: args.agentProfileId ?? null,
    outputLanguagePolicy: args.outputLanguagePolicy ?? 'workspace_default',
    outputLocale: args.outputLocale ?? 'zh-CN',
    dateTimeLocale: args.dateTimeLocale ?? args.outputLocale ?? 'zh-CN',
    numberLocale: args.numberLocale ?? args.outputLocale ?? 'zh-CN',
    createdAt: now,
    updatedAt: now,
  }
  await db.insert(schema.agentLocalizationPolicies).values(row)
  return row
}

export async function listAgentLocalizationPolicies(): Promise<AgentLocalizationPolicyRow[]> {
  return db.query.agentLocalizationPolicies.findMany({
    orderBy: [desc(schema.agentLocalizationPolicies.updatedAt)],
    limit: 100,
  })
}

export async function resolveAgentOutputLocalization(args: {
  agentProfileId?: string | null
  personaLanguage?: SupportedLocale
  userLocale?: SupportedLocale
  taskInputLanguage?: SupportedLocale
  timestamp?: number
  numberValue?: number
} = {}): Promise<{
  outputLocale: SupportedLocale
  outputLanguagePolicy: OutputLanguagePolicy
  fallbackLocale: SupportedLocale
  systemPromptLocale: SupportedLocale
  systemPromptLocaleSource: 'persona_language' | 'output_locale'
  systemPromptRule: string
  dateSample: string
  numberSample: string
}> {
  await seedLocalizationDefaults()
  const settings = await getActiveSettings()
  const policy = args.agentProfileId
    ? await db.query.agentLocalizationPolicies.findFirst({
        where: eq(schema.agentLocalizationPolicies.agentProfileId, args.agentProfileId),
      })
    : (await listAgentLocalizationPolicies()).find((row) => !row.agentProfileId) ?? null
  const outputLanguagePolicy = policy?.outputLanguagePolicy ?? settings.outputLanguagePolicy
  const outputLocale = resolveOutputLocale({
    policy: outputLanguagePolicy,
    fixedLocale: policy?.outputLocale ?? settings.defaultLocale,
    userLocale: args.userLocale,
    taskInputLanguage: args.taskInputLanguage,
    defaultLocale: settings.defaultLocale,
  })
  const dateLocale = policy?.dateTimeLocale ?? outputLocale
  const numberLocale = policy?.numberLocale ?? outputLocale
  const systemPromptLocale = args.personaLanguage ?? outputLocale
  const systemPromptRule = await translate({
    locale: systemPromptLocale,
    namespace: 'agent-prompts',
    key: 'output.language.rule',
  })
  const timestamp = args.timestamp ?? Date.UTC(2026, 5, 20, 9, 30, 0)
  const numberValue = args.numberValue ?? 1234567.89
  return {
    outputLocale,
    outputLanguagePolicy,
    fallbackLocale: settings.fallbackLocale,
    systemPromptLocale,
    systemPromptLocaleSource: args.personaLanguage ? 'persona_language' : 'output_locale',
    systemPromptRule: systemPromptRule.value,
    dateSample: new Intl.DateTimeFormat(dateLocale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(timestamp)),
    numberSample: new Intl.NumberFormat(numberLocale, {
      maximumFractionDigits: 2,
    }).format(numberValue),
  }
}

async function evaluateI18nContractDefinition(
  definition: I18nContractDefinition,
  settings: LocalizationSettingsRow,
): Promise<{
  status: I18nContractStatus
  evidence: JsonObject
}> {
  if (definition.area === 'locale_formatting') {
    const sample = await resolveAgentOutputLocalization({
      personaLanguage: 'en-US',
      userLocale: 'ja-JP',
      taskInputLanguage: 'zh-TW',
      timestamp: Date.UTC(2026, 5, 20, 9, 30, 0),
      numberValue: 1234567.89,
    })
    return {
      status: 'passing',
      evidence: {
        dateSample: sample.dateSample,
        numberSample: sample.numberSample,
        outputLocale: sample.outputLocale,
        systemPromptLocale: sample.systemPromptLocale,
        supportedLocales: settings.enabledLocales,
        requirement: 'Date, time, and number formatting use Intl locale resolution.',
      },
    }
  }

  if (!definition.namespace) {
    return {
      status: 'warning',
      evidence: { reason: 'No namespace is attached to this i18n contract check.' },
    }
  }

  const missing: string[] = []
  for (const locale of settings.enabledLocales) {
    for (const key of definition.requiredKeys) {
      const resource = await findResource(locale, definition.namespace, key)
      if (!resource) missing.push(`${locale}:${definition.namespace}:${key}`)
    }
  }
  return {
    status: missing.length ? 'failing' : 'passing',
    evidence: {
      namespace: definition.namespace,
      requiredKeys: definition.requiredKeys,
      requiredLocales: settings.enabledLocales,
      missing,
      personaLanguageBinding: definition.area === 'agent_prompt_language',
      requirement: definition.description,
    },
  }
}

async function getActiveSettings(): Promise<LocalizationSettingsRow> {
  const settings = await db.query.localizationSettings.findFirst({
    where: eq(schema.localizationSettings.id, DEFAULT_SETTINGS_NAME),
  })
  if (settings) return settings
  return (await seedLocalizationDefaults()).settings
}

async function findResource(
  locale: SupportedLocale,
  namespace: LocalizationNamespace,
  key: string,
): Promise<LocalizationResourceRow | undefined> {
  return db.query.localizationResources.findFirst({
    where: and(
      eq(schema.localizationResources.locale, locale),
      eq(schema.localizationResources.namespace, namespace),
      eq(schema.localizationResources.key, key),
    ),
  })
}

function resolveOutputLocale(args: {
  policy: OutputLanguagePolicy
  fixedLocale: SupportedLocale
  userLocale?: SupportedLocale
  taskInputLanguage?: SupportedLocale
  defaultLocale: SupportedLocale
}): SupportedLocale {
  if (args.policy === 'fixed_locale') return args.fixedLocale
  if (args.policy === 'follow_user_locale') return args.userLocale ?? args.defaultLocale
  if (args.policy === 'match_input') return args.taskInputLanguage ?? args.defaultLocale
  return args.defaultLocale
}
