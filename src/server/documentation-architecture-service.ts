import { and, asc, eq, type SQL } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  DocumentationPageRow,
  DocumentationPageStatus,
  DocumentationSectionCategory,
  DocumentationSectionRow,
} from '@/db/schema'
import { newDocumentationPageId, newDocumentationSectionId } from '@/server/ids'

interface DefaultDocumentationPage {
  slug: string
  title: string
  summary: string
}

interface DefaultDocumentationSection {
  category: DocumentationSectionCategory
  directory: string
  title: string
  description: string
  ownerAudience: string
  pages: DefaultDocumentationPage[]
}

const defaultSections: DefaultDocumentationSection[] = [
  {
    category: 'getting_started',
    directory: 'docs/getting-started',
    title: 'Getting Started',
    description: 'Installation, quick start, and first Agent onboarding.',
    ownerAudience: 'new_users',
    pages: [
      { slug: 'installation', title: 'Installation', summary: 'Install and launch the local desktop app.' },
      { slug: 'quick-start', title: 'Quick Start', summary: 'Create the first usable workflow quickly.' },
      { slug: 'first-agent', title: 'First Agent', summary: 'Configure and test the first virtual employee.' },
    ],
  },
  {
    category: 'user_guide',
    directory: 'docs/user-guide',
    title: 'User Guide',
    description: 'Daily product usage for Agent creation, tools, workflows, memory, and monitoring.',
    ownerAudience: 'operators',
    pages: [
      { slug: 'agent-factory', title: 'Agent Factory', summary: 'Create and configure Agent employee profiles.' },
      { slug: 'models', title: 'Models', summary: 'Manage model profiles, fallbacks, and connection tests.' },
      { slug: 'skills', title: 'Skills', summary: 'Install, enable, and assign Skills.' },
      { slug: 'tools', title: 'Tools', summary: 'Connect MCP, CLI, API, and software capabilities.' },
      { slug: 'canvas', title: 'Canvas', summary: 'Build and run Agent workflow canvases.' },
      { slug: 'memory', title: 'Memory', summary: 'Review memory, learning events, and playbooks.' },
      { slug: 'monitoring', title: 'Monitoring', summary: 'Watch runs, approvals, logs, and artifacts.' },
    ],
  },
  {
    category: 'advanced',
    directory: 'docs/advanced',
    title: 'Advanced',
    description: 'Advanced workflows, teams, capability graph, SDK, and CLI operation.',
    ownerAudience: 'power_users',
    pages: [
      { slug: 'workflows', title: 'Workflows', summary: 'Compose multi-Agent and approval workflows.' },
      { slug: 'teams', title: 'Teams', summary: 'Design collaborative Agent teams.' },
      { slug: 'knowledge-graph', title: 'Knowledge Graph', summary: 'Use capability and knowledge graph records.' },
      { slug: 'sdk', title: 'SDK', summary: 'Drive Agents through programmatic APIs.' },
      { slug: 'cli', title: 'CLI', summary: 'Register and orchestrate CLI profiles.' },
    ],
  },
  {
    category: 'developer',
    directory: 'docs/developer',
    title: 'Developer',
    description: 'Architecture, contribution, Skill/plugin development, and API references.',
    ownerAudience: 'developers',
    pages: [
      { slug: 'architecture', title: 'Architecture', summary: 'Understand the repo and service boundaries.' },
      { slug: 'contributing', title: 'Contributing', summary: 'Set up development and contribution workflow.' },
      { slug: 'skill-dev', title: 'Skill Development', summary: 'Create, test, and publish Skills.' },
      { slug: 'plugin-dev', title: 'Plugin Development', summary: 'Build and package local plugins.' },
      { slug: 'api-reference', title: 'API Reference', summary: 'Reference local API routes and payloads.' },
    ],
  },
  {
    category: 'troubleshooting',
    directory: 'docs/troubleshooting',
    title: 'Troubleshooting',
    description: 'Common issues, error codes, and performance diagnostics.',
    ownerAudience: 'support',
    pages: [
      { slug: 'common-issues', title: 'Common Issues', summary: 'Map symptoms to causes and fixes.' },
      { slug: 'error-codes', title: 'Error Codes', summary: 'Use the RX error catalog.' },
      { slug: 'performance', title: 'Performance', summary: 'Diagnose slow runs and resource pressure.' },
    ],
  },
  {
    category: 'reference',
    directory: 'docs/reference',
    title: 'Reference',
    description: 'Glossary, keyboard shortcuts, and Reasonix file formats.',
    ownerAudience: 'all_users',
    pages: [
      { slug: 'glossary', title: 'Glossary', summary: 'Map user-facing and internal terms.' },
      { slug: 'shortcuts', title: 'Shortcuts', summary: 'Keyboard shortcut reference.' },
      { slug: 'file-formats', title: 'File Formats', summary: 'Reasonix import/export file formats.' },
    ],
  },
  {
    category: 'release_notes',
    directory: 'docs/release-notes',
    title: 'Release Notes',
    description: 'Versioned change history and upgrade notes.',
    ownerAudience: 'all_users',
    pages: [
      { slug: 'README', title: 'Release Notes', summary: 'Track product changes by release.' },
    ],
  },
]

export function getDefaultDocumentationArchitecture(): DefaultDocumentationSection[] {
  return defaultSections.map((section) => ({
    ...section,
    pages: section.pages.map((page) => ({ ...page })),
  }))
}

export async function seedDocumentationArchitecture(): Promise<{
  sections: DocumentationSectionRow[]
  pages: DocumentationPageRow[]
}> {
  const now = Date.now()
  for (const section of defaultSections) {
    let sectionRow = await db.query.documentationSections.findFirst({
      where: eq(schema.documentationSections.category, section.category),
    })
    if (!sectionRow) {
      const row = {
        id: newDocumentationSectionId(),
        category: section.category,
        directory: section.directory,
        title: section.title,
        description: section.description,
        topicSlugs: section.pages.map((page) => page.slug),
        ownerAudience: section.ownerAudience,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      await db.insert(schema.documentationSections).values(row)
      sectionRow = row
    }
    for (const page of section.pages) {
      const filePath = `${section.directory}/${page.slug === 'README' ? 'README' : page.slug}.md`
      const existingPage = await db.query.documentationPages.findFirst({
        where: eq(schema.documentationPages.filePath, filePath),
      })
      if (existingPage) continue
      await db.insert(schema.documentationPages).values({
        id: newDocumentationPageId(),
        sectionId: sectionRow.id,
        category: section.category,
        slug: page.slug,
        filePath,
        title: page.title,
        summary: page.summary,
        status: 'published',
        required: true,
        createdAt: now,
        updatedAt: now,
      })
    }
  }
  return {
    sections: await listDocumentationSections(),
    pages: await listDocumentationPages(),
  }
}

export async function listDocumentationSections(args: {
  category?: DocumentationSectionCategory
  status?: string
  limit?: number
} = {}): Promise<DocumentationSectionRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.documentationSections.category, args.category))
  if (args.status) conditions.push(eq(schema.documentationSections.status, args.status))
  return db.query.documentationSections.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.documentationSections.category)],
    limit: args.limit ?? 100,
  })
}

export async function listDocumentationPages(args: {
  category?: DocumentationSectionCategory
  sectionId?: string
  status?: DocumentationPageStatus
  limit?: number
} = {}): Promise<DocumentationPageRow[]> {
  const conditions: SQL[] = []
  if (args.category) conditions.push(eq(schema.documentationPages.category, args.category))
  if (args.sectionId) conditions.push(eq(schema.documentationPages.sectionId, args.sectionId))
  if (args.status) conditions.push(eq(schema.documentationPages.status, args.status))
  return db.query.documentationPages.findMany({
    where: conditions.length ? and(...conditions) : undefined,
    orderBy: [asc(schema.documentationPages.category), asc(schema.documentationPages.slug)],
    limit: args.limit ?? 200,
  })
}
