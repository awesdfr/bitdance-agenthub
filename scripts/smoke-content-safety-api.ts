import { NextRequest } from 'next/server'

import { GET as getAudit } from '../src/app/api/implementation-audit/route'
import {
  GET as listChecks,
  POST as createCheck,
} from '../src/app/api/content-safety/copyright-checks/route'
import {
  GET as listPolicies,
  POST as createPolicy,
} from '../src/app/api/content-safety/policies/route'
import { POST as seedPolicies } from '../src/app/api/content-safety/policies/seed/route'
import { POST as scanOutput } from '../src/app/api/content-safety/scan/route'
import { GET as listScans } from '../src/app/api/content-safety/scans/route'

async function readJson(response: Response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }
  return response.json()
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const seeded = await readJson(await seedPolicies())
  const policyResponse = await readJson(
    await createPolicy(
      new NextRequest('http://local/api/content-safety/policies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Smoke redact policy',
          onFlag: 'redact',
          layers: {
            keywordFilter: {
              blockedPatterns: ['password\\s*='],
              piiPatterns: ['\\b[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}\\b'],
            },
            localClassifier: {
              categories: ['spam', 'violence', 'self_harm'],
              threshold: 0.5,
            },
          },
        }),
      }),
    ),
  )
  const policy = policyResponse.policy
  const scanResponse = await readJson(
    await scanOutput(
      new NextRequest('http://local/api/content-safety/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          policyId: policy.id,
          contentType: 'document',
          content: 'Please email admin@example.com and set password=123456 before publishing.',
        }),
      }),
    ),
  )
  const source = 'function exportedHelper() { return "same licensed implementation block"; }'
  const copyrightResponse = await readJson(
    await createCheck(
      new NextRequest('http://local/api/content-safety/copyright-checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scanId: scanResponse.scan.id,
          contentType: 'code',
          content: source,
          config: {
            codePlagiarism: {
              similarityThreshold: 0.4,
              minMatchLength: 20,
              onMatch: 'warn_with_attribution',
            },
          },
          knownSources: [{
            sourceRef: 'github:example/project',
            content: source,
            license: 'MIT',
            attribution: 'Example Project contributors',
          }],
        }),
      }),
    ),
  )
  const imageCheckResponse = await readJson(
    await createCheck(
      new NextRequest('http://local/api/content-safety/copyright-checks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contentType: 'image',
          config: {
            imageCopyright: {
              checkMetadata: true,
              reverseImageSearch: true,
            },
          },
          imageMetadata: {
            copyright: 'Copyright Example Studio',
          },
        }),
      }),
    ),
  )
  const policies = await readJson(
    await listPolicies(new NextRequest('http://local/api/content-safety/policies?status=active')),
  )
  const scans = await readJson(
    await listScans(new NextRequest('http://local/api/content-safety/scans?status=flagged')),
  )
  const checks = await readJson(
    await listChecks(new NextRequest('http://local/api/content-safety/copyright-checks?status=needs_attribution')),
  )
  const audit = await readJson(await getAudit())

  assert(seeded.policies.length >= 1, 'Expected seeded content safety policy')
  assert(policy.onFlag === 'redact', `Unexpected policy action: ${policy.onFlag}`)
  assert(scanResponse.scan.decision === 'redact', `Unexpected scan decision: ${scanResponse.scan.decision}`)
  assert(scanResponse.scan.categories.includes('pii'), 'Expected PII finding')
  assert(scanResponse.scan.redactedPreview.includes('[REDACTED]'), 'Expected redacted preview')
  assert(copyrightResponse.check.status === 'needs_attribution', `Unexpected copyright status: ${copyrightResponse.check.status}`)
  assert(copyrightResponse.check.matchedSourceRefs.length === 1, 'Expected one matched source')
  assert(imageCheckResponse.check.externalSearchRequired === true, 'Expected reverse image search to be recorded')
  assert(policies.policies.some((row: { id: string }) => row.id === policy.id), 'Policy should be listable')
  assert(scans.scans.some((row: { id: string }) => row.id === scanResponse.scan.id), 'Scan should be listable')
  assert(checks.checks.some((row: { id: string }) => row.id === copyrightResponse.check.id), 'Check should be listable')
  assert(
    audit.summary.implementedBaselineSections === 210 &&
      audit.summary.partialSections === 0 &&
      audit.summary.pendingSections === 0,
    `Unexpected audit summary: ${JSON.stringify(audit.summary)}`,
  )
  assert(
    audit.sections[119]?.implementationStatus === 'baseline_plus',
    `Section 120 was not promoted: ${JSON.stringify(audit.sections[119])}`,
  )

  console.log(
    JSON.stringify(
      {
        seededPolicies: seeded.policies.length,
        policyAction: policy.onFlag,
        scanDecision: scanResponse.scan.decision,
        scanCategories: scanResponse.scan.categories,
        copyrightStatus: copyrightResponse.check.status,
        imageExternalSearchRequired: imageCheckResponse.check.externalSearchRequired,
        auditSummary: audit.summary,
        section120Status: audit.sections[119]?.implementationStatus,
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
