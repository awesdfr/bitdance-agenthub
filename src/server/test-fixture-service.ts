import { asc, desc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type {
  JsonObject,
  TestFixtureGenerationRunRow,
  TestFixtureSpecRow,
  TestFixtureType,
} from '@/db/schema'
import { newTestFixtureGenerationRunId, newTestFixtureSpecId } from '@/server/ids'

interface DefaultFixtureSpec {
  fixtureType: TestFixtureType
  name: string
  description: string
  contentKind: string
  metadata: JsonObject
}

interface MaterializedFixture {
  generatedFiles: string[]
  generatedBytes: number
  resultSummary: JsonObject
}

const defaultFixtureSpecs: DefaultFixtureSpec[] = [
  {
    fixtureType: 'file',
    name: 'simple.txt',
    description: 'Small UTF-8 text file for basic read/write smoke tests.',
    contentKind: 'text',
    metadata: { fileName: 'simple.txt', lineCount: 3 },
  },
  {
    fixtureType: 'file',
    name: 'large.csv',
    description: 'CSV fixture with exactly 10000 data rows.',
    contentKind: 'csv',
    metadata: { fileName: 'large.csv', rowCount: 10000, columns: ['id', 'name', 'value'] },
  },
  {
    fixtureType: 'file',
    name: 'malformed.json',
    description: 'Intentionally malformed JSON for parser failure paths.',
    contentKind: 'json',
    metadata: { fileName: 'malformed.json', malformed: true },
  },
  {
    fixtureType: 'file',
    name: 'binary.dat',
    description: 'Small deterministic binary payload.',
    contentKind: 'binary',
    metadata: { fileName: 'binary.dat', byteCount: 256, encoding: 'base64' },
  },
  {
    fixtureType: 'file',
    name: 'emoji-filename',
    description: 'File fixture with an emoji filename.',
    contentKind: 'text',
    metadata: { fileName: 'emoji-\u{1F680}.txt', unicodeVariant: 'emoji_filename' },
  },
  {
    fixtureType: 'file',
    name: 'long-path-file',
    description: 'Deep path fixture for long path handling.',
    contentKind: 'text',
    metadata: { fileName: 'long-path-file.txt', pathDepth: 32, targetPathLength: 240 },
  },
  {
    fixtureType: 'project_template',
    name: 'react-app',
    description: 'Minimal React app template.',
    contentKind: 'project',
    metadata: { files: ['package.json', 'src/App.tsx', 'src/main.tsx', 'index.html'] },
  },
  {
    fixtureType: 'project_template',
    name: 'node-api',
    description: 'Minimal Node API project template.',
    contentKind: 'project',
    metadata: { files: ['package.json', 'src/server.ts', 'tests/server.test.ts'] },
  },
  {
    fixtureType: 'project_template',
    name: 'python-data',
    description: 'Python data processing template.',
    contentKind: 'project',
    metadata: { files: ['pyproject.toml', 'src/pipeline.py', 'tests/test_pipeline.py', 'data/sample.csv'] },
  },
  {
    fixtureType: 'project_template',
    name: 'monorepo',
    description: 'Tiny monorepo with web, api, and shared packages.',
    contentKind: 'project',
    metadata: { files: ['pnpm-workspace.yaml', 'apps/web/package.json', 'apps/api/package.json', 'packages/shared/package.json'] },
  },
  {
    fixtureType: 'web_fixture',
    name: 'simple-form',
    description: 'HTML form fixture with labels and submit button.',
    contentKind: 'html',
    metadata: { selectors: ['#name', '#email', 'button[type=submit]'] },
  },
  {
    fixtureType: 'web_fixture',
    name: 'dynamic-table',
    description: 'Table fixture with dynamic rows and sortable columns.',
    contentKind: 'html',
    metadata: { rowCount: 25, selectors: ['table', '[data-sort]'] },
  },
  {
    fixtureType: 'web_fixture',
    name: 'broken-html',
    description: 'Malformed HTML for resilient browser/parser tests.',
    contentKind: 'html',
    metadata: { malformed: true },
  },
  {
    fixtureType: 'web_fixture',
    name: 'captcha-protected',
    description: 'CAPTCHA placeholder fixture that must trigger manual/human-gated behavior.',
    contentKind: 'html',
    metadata: { captchaProtected: true, expectedBehavior: 'request_human_approval' },
  },
  {
    fixtureType: 'memory_fixture',
    name: 'project-memories-100',
    description: 'One hundred project memory items.',
    contentKind: 'jsonl',
    metadata: { memoryType: 'project', count: 100 },
  },
  {
    fixtureType: 'memory_fixture',
    name: 'customer-preferences-50',
    description: 'Fifty customer preference memory items.',
    contentKind: 'jsonl',
    metadata: { memoryType: 'customer', count: 50 },
  },
  {
    fixtureType: 'memory_fixture',
    name: 'mistake-experiences-30',
    description: 'Thirty mistake/lesson memory items.',
    contentKind: 'jsonl',
    metadata: { memoryType: 'mistake', count: 30 },
  },
]

export function getDefaultTestFixtureCount(): number {
  return defaultFixtureSpecs.length
}

export async function seedDefaultTestFixtures(): Promise<TestFixtureSpecRow[]> {
  const now = Date.now()
  for (const spec of defaultFixtureSpecs) {
    const existing = await db.query.testFixtureSpecs.findFirst({
      where: eq(schema.testFixtureSpecs.name, spec.name),
    })
    if (existing) continue
    await db.insert(schema.testFixtureSpecs).values({
      id: newTestFixtureSpecId(),
      fixtureType: spec.fixtureType,
      name: spec.name,
      description: spec.description,
      contentKind: spec.contentKind,
      metadata: spec.metadata,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listTestFixtureSpecs()
}

export async function listTestFixtureSpecs(args: {
  fixtureType?: TestFixtureType
} = {}): Promise<TestFixtureSpecRow[]> {
  return db.query.testFixtureSpecs.findMany({
    where: args.fixtureType ? eq(schema.testFixtureSpecs.fixtureType, args.fixtureType) : undefined,
    orderBy: [asc(schema.testFixtureSpecs.fixtureType), asc(schema.testFixtureSpecs.name)],
    limit: 100,
  })
}

export async function listTestFixtureGenerationRuns(): Promise<TestFixtureGenerationRunRow[]> {
  return db.query.testFixtureGenerationRuns.findMany({
    orderBy: [desc(schema.testFixtureGenerationRuns.createdAt)],
    limit: 100,
  })
}

export async function generateTestFixture(args: {
  fixtureId: string
  targetPath?: string | null
}): Promise<TestFixtureGenerationRunRow> {
  const fixture = await db.query.testFixtureSpecs.findFirst({
    where: eq(schema.testFixtureSpecs.id, args.fixtureId),
  })
  if (!fixture) throw new Error(`Test fixture not found: ${args.fixtureId}`)
  const materialized = materializeFixture(fixture)
  const row: TestFixtureGenerationRunRow = {
    id: newTestFixtureGenerationRunId(),
    fixtureId: fixture.id,
    targetPath: args.targetPath?.trim() || null,
    status: 'generated',
    generatedFiles: materialized.generatedFiles,
    generatedBytes: materialized.generatedBytes,
    resultSummary: {
      ...materialized.resultSummary,
      recordOnly: true,
      fixtureType: fixture.fixtureType,
      contentKind: fixture.contentKind,
    },
    createdAt: Date.now(),
  }
  await db.insert(schema.testFixtureGenerationRuns).values(row)
  return row
}

function materializeFixture(fixture: TestFixtureSpecRow): MaterializedFixture {
  if (fixture.fixtureType === 'file') return materializeFileFixture(fixture)
  if (fixture.fixtureType === 'project_template') return materializeProjectTemplate(fixture)
  if (fixture.fixtureType === 'web_fixture') return materializeWebFixture(fixture)
  return materializeMemoryFixture(fixture)
}

function materializeFileFixture(fixture: TestFixtureSpecRow): MaterializedFixture {
  const fileName = readString(fixture.metadata.fileName) || fixture.name
  if (fixture.name === 'large.csv') {
    const csv = createLargeCsv()
    return {
      generatedFiles: [fileName],
      generatedBytes: Buffer.byteLength(csv),
      resultSummary: {
        rowCount: 10000,
        columns: ['id', 'name', 'value'],
        preview: csv.split('\n').slice(0, 4),
      },
    }
  }
  if (fixture.name === 'malformed.json') {
    const content = '{"ok": true,\n'
    return {
      generatedFiles: [fileName],
      generatedBytes: Buffer.byteLength(content),
      resultSummary: { malformed: true, parserShouldFail: true },
    }
  }
  if (fixture.name === 'binary.dat') {
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, index) => index % 256))
    return {
      generatedFiles: [fileName],
      generatedBytes: bytes.length,
      resultSummary: { byteCount: bytes.length, base64Preview: bytes.toString('base64').slice(0, 32) },
    }
  }
  if (fixture.name === 'long-path-file') {
    const pathParts = Array.from({ length: 32 }, (_, index) => `segment-${index + 1}`)
    const generated = `${pathParts.join('/')}/${fileName}`
    return {
      generatedFiles: [generated],
      generatedBytes: Buffer.byteLength('long path fixture\n'),
      resultSummary: { pathDepth: 32, pathLength: generated.length },
    }
  }
  const content = fixture.name === 'emoji-filename' ? 'emoji filename fixture\n' : 'hello\nfrom\nfixture\n'
  return {
    generatedFiles: [fileName],
    generatedBytes: Buffer.byteLength(content),
    resultSummary: { lineCount: content.trimEnd().split('\n').length },
  }
}

function materializeProjectTemplate(fixture: TestFixtureSpecRow): MaterializedFixture {
  const files = readStringArray(fixture.metadata.files)
  return {
    generatedFiles: files,
    generatedBytes: files.reduce((sum, file) => sum + Buffer.byteLength(`${fixture.name}:${file}\n`), 0),
    resultSummary: { template: fixture.name, fileCount: files.length, files },
  }
}

function materializeWebFixture(fixture: TestFixtureSpecRow): MaterializedFixture {
  const fileName = `${fixture.name}.html`
  const html = createWebFixtureHtml(fixture.name)
  return {
    generatedFiles: [fileName],
    generatedBytes: Buffer.byteLength(html),
    resultSummary: {
      urlPath: `/fixtures/web/${fileName}`,
      selectors: readStringArray(fixture.metadata.selectors),
      captchaProtected: fixture.metadata.captchaProtected === true,
      malformed: fixture.metadata.malformed === true,
    },
  }
}

function materializeMemoryFixture(fixture: TestFixtureSpecRow): MaterializedFixture {
  const count = readNumber(fixture.metadata.count)
  const memoryType = readString(fixture.metadata.memoryType) || 'project'
  const rows = Array.from({ length: count }, (_, index) =>
    JSON.stringify({
      id: `${fixture.name}-${index + 1}`,
      type: memoryType,
      title: `${memoryType} memory ${index + 1}`,
      content: `Fixture ${memoryType} memory item ${index + 1}.`,
    }),
  )
  const content = `${rows.join('\n')}\n`
  return {
    generatedFiles: [`memory/${fixture.name}.jsonl`],
    generatedBytes: Buffer.byteLength(content),
    resultSummary: { memoryType, count, lineCount: rows.length },
  }
}

function createLargeCsv(): string {
  const rows = ['id,name,value']
  for (let index = 1; index <= 10000; index += 1) {
    rows.push(`${index},Item ${index},${(index % 97) + 1}`)
  }
  return `${rows.join('\n')}\n`
}

function createWebFixtureHtml(name: string): string {
  if (name === 'simple-form') {
    return '<form><label>Name<input id="name" /></label><label>Email<input id="email" /></label><button type="submit">Submit</button></form>'
  }
  if (name === 'dynamic-table') {
    return `<table>${Array.from({ length: 25 }, (_, index) => `<tr><td>${index + 1}</td><td data-sort>Row ${index + 1}</td></tr>`).join('')}</table>`
  }
  if (name === 'captcha-protected') {
    return '<main><div data-captcha="true">CAPTCHA required</div><button>Request human approval</button></main>'
  }
  return '<html><body><section><p>broken'
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}
