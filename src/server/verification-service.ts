import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  AgentProfileRow,
  ArtifactValidationRow,
  EmployeeRunRow,
  JsonObject,
  OutputAccessibilityPolicy,
} from '@/db/schema'
import { newArtifactValidationId } from '@/server/ids'
import {
  getRequiredMultimodalInputKinds,
  getRequiredMultimodalOutputKinds,
  listMultimodalInputsForRun,
  listMultimodalOutputsForRun,
} from '@/server/multimodal-io-service'
import { evaluateStyleGuideCompliance } from '@/server/style-guide-service'

export async function validateEmployeeRunArtifactContract(args: {
  run: EmployeeRunRow
  agent: AgentProfileRow
  output: JsonObject
}): Promise<ArtifactValidationRow> {
  const artifactType = getString(args.agent.outputContract, 'artifactType')
  const validationRules = getStringArray(args.agent.outputContract, 'validationRules')
  const requiredFiles = getStringArray(args.agent.outputContract, 'requiredFiles')
  const outputStatus = getString(args.output, 'status')
  const [multimodalInputs, multimodalOutputs] = await Promise.all([
    listMultimodalInputsForRun(args.run.id),
    listMultimodalOutputsForRun(args.run.id),
  ])
  const styleGuide = await evaluateStyleGuideCompliance({
    agentProfileId: args.agent.id,
    sample: extractStyleGuideSample(args.output, artifactType, validationRules),
  })
  const accessibility = evaluateOutputAccessibility({
    artifactType,
    output: args.output,
    policy: readAccessibilityPolicy(args.agent.outputContract),
  })
  const requiredInputKinds = getRequiredMultimodalInputKinds(args.agent.inputContract)
  const requiredOutputKinds = getRequiredMultimodalOutputKinds(args.agent.outputContract)
  const validInputKinds = new Set(
    multimodalInputs.filter((row) => row.status !== 'rejected').map((row) => row.kind),
  )
  const validOutputKinds = new Set(
    multimodalOutputs.filter((row) => row.status !== 'rejected').map((row) => row.kind),
  )
  const missing: string[] = []

  if (!artifactType) missing.push('outputContract.artifactType')
  if (outputStatus !== 'ready_for_executor') missing.push('output.status=ready_for_executor')
  for (const kind of requiredInputKinds) {
    if (!validInputKinds.has(kind)) missing.push(`multimodal.input.${kind}`)
  }
  for (const kind of requiredOutputKinds) {
    if (!validOutputKinds.has(kind)) missing.push(`multimodal.output.${kind}`)
  }
  if (!styleGuide.passed) missing.push('styleGuide.compliance')
  if (!accessibility.passed) missing.push(...accessibility.missing)

  const status = missing.length === 0 ? 'passed' : 'failed'
  const result: JsonObject = {
    artifactType,
    outputStatus,
    requiredFiles,
    requiredInputKinds,
    requiredOutputKinds,
    observedInputKinds: [...validInputKinds],
    observedOutputKinds: [...validOutputKinds],
    styleGuide: styleGuide as unknown as JsonObject,
    accessibility: accessibility as unknown as JsonObject,
    passedRules: validationRules,
    missing,
    note:
      status === 'passed'
        ? 'Output contract is ready for a downstream model, CLI, software, or artifact executor.'
        : 'Output contract is missing required readiness fields.',
  }
  const row = {
    id: newArtifactValidationId(),
    artifactId: null,
    runId: args.run.id,
    status,
    rules: validationRules,
    result,
    createdAt: Date.now(),
  } satisfies ArtifactValidationRow

  await db.insert(schema.artifactValidations).values(row)
  return row
}

export async function listArtifactValidationsForRun(runId: string): Promise<ArtifactValidationRow[]> {
  return db.query.artifactValidations.findMany({
    where: eq(schema.artifactValidations.runId, runId),
    orderBy: [asc(schema.artifactValidations.createdAt)],
  })
}

export function evaluateOutputAccessibility(args: {
  artifactType: string | null
  output: JsonObject
  policy: OutputAccessibilityPolicy
}): {
  enabled: boolean
  passed: boolean
  checks: string[]
  missing: string[]
  warnings: string[]
  suggestions: string[]
  generatedAltText: string[]
  suggestedColorBlindPalette: string[]
} {
  const checks: string[] = []
  const missing: string[] = []
  const warnings: string[] = []
  const suggestions: string[] = []
  const generatedAltText: string[] = []
  const suggestedColorBlindPalette: string[] = []
  const enabled = hasAccessibilityPolicy(args.policy)
  if (!enabled) {
    return {
      enabled: false,
      passed: true,
      checks,
      missing,
      warnings,
      suggestions,
      generatedAltText,
      suggestedColorBlindPalette,
    }
  }

  const htmlText = extractTextPayload(args.output, ['html', 'htmlContent', 'markup'])
  const documentText = extractTextPayload(args.output, ['document', 'markdown', 'report', 'text'])
  const images = extractImagePayloads(args.output)

  if (args.policy.html && hasEnabled(args.policy.html)) {
    if (!htmlText) {
      warnings.push('HTML accessibility checks are configured, but no HTML payload was present.')
    } else {
      if (args.policy.html.requireAltText) {
        checks.push('html.requireAltText')
        const badImages = findHtmlImagesMissingAlt(htmlText)
        if (badImages.length > 0) {
          missing.push('accessibility.html.img.alt')
          suggestions.push(`Add non-empty alt text to ${badImages.length} HTML image element(s).`)
        }
      }
      if (args.policy.html.requireSemanticHTML) {
        checks.push('html.requireSemanticHTML')
        if (!hasSemanticHtml(htmlText)) {
          missing.push('accessibility.html.semantic_html')
          suggestions.push('Use semantic tags such as main, nav, header, section, article, button, and headings.')
        }
      }
      if (args.policy.html.requireARIALabels) {
        checks.push('html.requireARIALabels')
        const unlabeled = findUnlabeledInteractiveElements(htmlText)
        if (unlabeled.length > 0) {
          missing.push('accessibility.html.aria_labels')
          suggestions.push(`Add visible text, aria-label, aria-labelledby, or title to ${unlabeled.length} interactive element(s).`)
        }
      }
      if (args.policy.html.checkColorContrast) {
        checks.push('html.checkColorContrast')
        const contrast = evaluateInlineColorContrast(htmlText)
        if (contrast.lowContrastCount > 0) {
          missing.push('accessibility.html.color_contrast')
          suggestions.push('Increase text/background contrast to at least WCAG 2.1 AA 4.5:1 for normal text.')
        } else if (contrast.checkedPairs === 0) {
          warnings.push('No inline text/background color pairs were available for contrast checking.')
        }
      }
    }
  }

  if (args.policy.documents && hasEnabled(args.policy.documents)) {
    if (!documentText) {
      warnings.push('Document accessibility checks are configured, but no document text payload was present.')
    } else {
      if (args.policy.documents.requireHeadings) {
        checks.push('documents.requireHeadings')
        if (!hasDocumentHeadings(documentText)) {
          missing.push('accessibility.documents.headings')
          suggestions.push('Add a clear heading hierarchy using markdown headings or h1-h6 elements.')
        }
      }
      if (args.policy.documents.requireDescriptiveLinks) {
        checks.push('documents.requireDescriptiveLinks')
        const genericLinks = findGenericLinkLabels(documentText)
        if (genericLinks.length > 0) {
          missing.push('accessibility.documents.descriptive_links')
          suggestions.push('Replace generic link labels with descriptive text such as "View full report".')
        }
      }
    }
  }

  if (args.policy.images && hasEnabled(args.policy.images)) {
    if (images.length === 0) {
      warnings.push('Image accessibility checks are configured, but no image payload was present.')
    } else {
      if (args.policy.images.generateAltText) {
        checks.push('images.generateAltText')
        const missingAlt = images.filter((image) => !image.altText)
        if (missingAlt.length > 0) {
          missing.push('accessibility.images.alt_text')
          for (const image of missingAlt) {
            generatedAltText.push(generateFallbackAltText(image))
          }
          suggestions.push('Attach generated alt text to each image artifact before handoff.')
        }
      }
      if (args.policy.images.suggestColorBlindPalette) {
        checks.push('images.suggestColorBlindPalette')
        const colorFamilies = new Set(images.flatMap((image) => image.colors.map(classifyColorFamily)))
        if (colorFamilies.has('red') && colorFamilies.has('green')) {
          warnings.push('Image palette relies on red/green differentiation.')
          suggestedColorBlindPalette.push('#0072B2', '#E69F00', '#009E73', '#CC79A7')
        }
      }
    }
  }

  return {
    enabled,
    passed: missing.length === 0,
    checks,
    missing,
    warnings,
    suggestions,
    generatedAltText,
    suggestedColorBlindPalette,
  }
}

function getString(obj: JsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getStringArray(obj: JsonObject, key: string): string[] {
  const value = obj[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function readAccessibilityPolicy(contract: JsonObject): OutputAccessibilityPolicy {
  const raw = contract.accessibility ?? contract.outputAccessibility
  if (!isPlainObject(raw)) return {}
  return {
    html: isPlainObject(raw.html)
      ? {
          requireAltText: raw.html.requireAltText === true,
          requireSemanticHTML: raw.html.requireSemanticHTML === true,
          requireARIALabels: raw.html.requireARIALabels === true,
          checkColorContrast: raw.html.checkColorContrast === true,
        }
      : undefined,
    documents: isPlainObject(raw.documents)
      ? {
          requireHeadings: raw.documents.requireHeadings === true,
          requireDescriptiveLinks: raw.documents.requireDescriptiveLinks === true,
        }
      : undefined,
    images: isPlainObject(raw.images)
      ? {
          generateAltText: raw.images.generateAltText === true,
          suggestColorBlindPalette: raw.images.suggestColorBlindPalette === true,
        }
      : undefined,
  }
}

function extractStyleGuideSample(
  output: JsonObject,
  artifactType: string | null,
  validationRules: string[],
): string | JsonObject {
  const text = extractTextPayload(output, [
    'artifactContent',
    'content',
    'text',
    'summary',
    'report',
    'markdown',
    'html',
  ])
  if (text) return text
  return {
    status: getString(output, 'status'),
    artifactType,
    validationRules,
    requiredArtifact: output.requiredArtifact ?? null,
  }
}

function hasAccessibilityPolicy(policy: OutputAccessibilityPolicy): boolean {
  return Boolean(
    (policy.html && hasEnabled(policy.html)) ||
      (policy.documents && hasEnabled(policy.documents)) ||
      (policy.images && hasEnabled(policy.images)),
  )
}

function hasEnabled(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some((value) => value === true)
}

function extractTextPayload(output: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = output[key]
    const text = stringifyTextPayload(value)
    if (text) return text
  }
  const content = stringifyTextPayload(output.content)
  return content && keys.some((key) => content.toLowerCase().includes(key.replace(/content/i, '')))
    ? content
    : null
}

function stringifyTextPayload(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (!isPlainObject(value)) return null
  for (const key of ['content', 'body', 'text', 'markdown', 'html']) {
    const nested = value[key]
    if (typeof nested === 'string' && nested.trim()) return nested
  }
  return null
}

function extractImagePayloads(output: JsonObject): Array<{
  src: string | null
  altText: string | null
  caption: string | null
  colors: string[]
}> {
  const rawImages = Array.isArray(output.images)
    ? output.images
    : output.image
      ? [output.image]
      : []
  return rawImages.filter(isPlainObject).map((image) => ({
    src: getRecordString(image, 'src') ?? getRecordString(image, 'url') ?? getRecordString(image, 'path'),
    altText:
      getRecordString(image, 'alt') ??
      getRecordString(image, 'altText') ??
      getRecordString(image, 'description'),
    caption: getRecordString(image, 'caption') ?? getRecordString(image, 'title'),
    colors: getRecordStringArray(image, 'colors').concat(getRecordStringArray(image, 'palette')),
  }))
}

function findHtmlImagesMissingAlt(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => {
      const alt = /\salt\s*=\s*(["'])(.*?)\1/i.exec(tag)
      return !alt || alt[2].trim().length === 0
    })
}

function hasSemanticHtml(html: string): boolean {
  return /<(main|nav|header|footer|article|section|aside|h[1-6])\b/i.test(html)
}

function findUnlabeledInteractiveElements(html: string): string[] {
  const unlabeled: string[] = []
  for (const match of html.matchAll(/<(button|a|select|textarea)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase()
    const attrs = match[2]
    const body = stripHtml(match[3])
    if (!hasAccessibleName(attrs, body)) unlabeled.push(tag)
  }
  for (const match of html.matchAll(/<input\b([^>]*)>/gi)) {
    if (!hasAccessibleName(match[1], '')) unlabeled.push('input')
  }
  return unlabeled
}

function hasAccessibleName(attrs: string, body: string): boolean {
  return (
    /\s(aria-label|aria-labelledby|title)\s*=\s*(["'])\s*\S[\s\S]*?\2/i.test(attrs) ||
    body.trim().length > 0
  )
}

function evaluateInlineColorContrast(html: string): { checkedPairs: number; lowContrastCount: number } {
  let checkedPairs = 0
  let lowContrastCount = 0
  for (const match of html.matchAll(/\sstyle\s*=\s*(["'])(.*?)\1/gi)) {
    const style = match[2]
    const foreground = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(style)?.[1]
    const background = /(?:^|;)\s*background(?:-color)?\s*:\s*(#[0-9a-f]{3,6})\b/i.exec(style)?.[1]
    if (!foreground || !background) continue
    checkedPairs += 1
    if (contrastRatio(foreground, background) < 4.5) lowContrastCount += 1
  }
  return { checkedPairs, lowContrastCount }
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(hexToRgb(foreground))
  const bg = relativeLuminance(hexToRgb(background))
  const lighter = Math.max(fg, bg)
  const darker = Math.min(fg, bg)
  return (lighter + 0.05) / (darker + 0.05)
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const full =
    normalized.length === 3
      ? normalized.split('').map((char) => `${char}${char}`).join('')
      : normalized.padEnd(6, '0').slice(0, 6)
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((channel) => {
    const scaled = channel / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hasDocumentHeadings(text: string): boolean {
  return /^#{1,6}\s+\S/m.test(text) || /<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/i.test(text)
}

function findGenericLinkLabels(text: string): string[] {
  const generic = new Set(['click here', 'here', 'read more', 'learn more', 'more', 'link', '点击这里', '这里'])
  const labels = [
    ...[...text.matchAll(/\[([^\]]+)\]\([^)]+\)/g)].map((match) => stripHtml(match[1])),
    ...[...text.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) => stripHtml(match[1])),
  ]
  return labels.filter((label) => generic.has(label.trim().toLowerCase()))
}

function generateFallbackAltText(image: { src: string | null; caption: string | null }): string {
  if (image.caption) return image.caption
  if (image.src) return `Image artifact from ${image.src.split(/[\\/]/).pop() ?? image.src}`
  return 'Image artifact generated by the Agent'
}

function classifyColorFamily(color: string): 'red' | 'green' | 'blue' | 'yellow' | 'other' {
  const [r, g, b] = hexToRgb(color)
  if (r > 180 && g < 120 && b < 120) return 'red'
  if (g > 140 && r < 140 && b < 140) return 'green'
  if (b > 140 && r < 140) return 'blue'
  if (r > 170 && g > 140 && b < 100) return 'yellow'
  return 'other'
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

function getRecordString(obj: Record<string, unknown>, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getRecordStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
