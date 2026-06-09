import { describe, expect, it } from 'vitest'

import type { DispatchPlanItem, TaskResultReport } from '@/shared/types'

import {
  evaluateTaskResultReport,
  isTaskResultReportToolName,
  readTaskResultReportFromToolResult,
} from './task-result-report'

function task(overrides: Partial<DispatchPlanItem> = {}): DispatchPlanItem {
  return {
    id: 't1',
    agentId: 'ag_reviewer',
    task: 'Review the implementation',
    ...overrides,
  }
}

const completeReport: TaskResultReport = {
  status: 'complete',
  summary: 'Reviewed the implementation and found it acceptable.',
  acceptanceResults: [
    {
      criterion: 'Checks PRD alignment',
      passed: true,
      evidence: 'The implementation covers the required PRD scope.',
    },
  ],
}

describe('readTaskResultReportFromToolResult', () => {
  it('parses direct CustomAgent tool results', () => {
    expect(readTaskResultReportFromToolResult(completeReport)).toEqual(completeReport)
  })

  it('parses Claude MCP text content', () => {
    expect(
      readTaskResultReportFromToolResult([
        { type: 'text', text: JSON.stringify(completeReport) },
      ]),
    ).toEqual(completeReport)
  })

  it('parses Codex MCP wrapper results', () => {
    expect(
      readTaskResultReportFromToolResult({
        result: {
          structuredContent: completeReport,
        },
        status: 'completed',
      }),
    ).toEqual(completeReport)
  })
})

describe('isTaskResultReportToolName', () => {
  it('matches direct and MCP-prefixed tool names', () => {
    expect(isTaskResultReportToolName('report_task_result')).toBe(true)
    expect(isTaskResultReportToolName('mcp__agenthub__report_task_result')).toBe(true)
    expect(isTaskResultReportToolName('codex_mcp_agenthub_report_task_result')).toBe(true)
    expect(isTaskResultReportToolName('write_artifact')).toBe(false)
  })
})

describe('evaluateTaskResultReport', () => {
  it('accepts complete reports with matching acceptance criteria', () => {
    expect(
      evaluateTaskResultReport(
        task({ acceptanceCriteria: ['Checks PRD alignment'] }),
        completeReport,
      ),
    ).toEqual({ ok: true })
  })

  it('does not use expectedOutputs as a completion gate', () => {
    expect(
      evaluateTaskResultReport(
        task({ expectedOutputs: [{ id: 'report', type: 'document' }] }),
        {
          status: 'complete',
          summary: 'The review was completed in the final message.',
        },
      ),
    ).toEqual({ ok: true })
  })

  it('fails when a child task omits report_task_result', () => {
    expect(evaluateTaskResultReport(task(), undefined)).toEqual({
      ok: false,
      error: 'Task "t1" completed without report_task_result',
    })
  })

  it('fails when the child reports failed or blocked', () => {
    expect(
      evaluateTaskResultReport(task(), {
        status: 'blocked',
        summary: 'Need missing credentials.',
        blockers: ['Missing API key'],
      }),
    ).toEqual({
      ok: false,
      error: 'Task "t1" reported blocked: Need missing credentials. Blockers: Missing API key',
    })
  })

  it('fails when acceptance criteria are missing or failed', () => {
    expect(
      evaluateTaskResultReport(task({ acceptanceCriteria: ['Checks PRD alignment'] }), {
        status: 'complete',
        summary: 'Done.',
      }),
    ).toEqual({
      ok: false,
      error: 'Task "t1" report is missing acceptance criteria result(s): Checks PRD alignment',
    })

    expect(
      evaluateTaskResultReport(task(), {
        status: 'complete',
        summary: 'Done.',
        acceptanceResults: [
          {
            criterion: 'Checks PRD alignment',
            passed: false,
            evidence: 'The implementation missed the export workflow.',
          },
        ],
      }),
    ).toEqual({
      ok: false,
      error:
        'Task "t1" did not satisfy acceptance criteria: Checks PRD alignment (The implementation missed the export workflow.)',
    })
  })

  it('accepts complete reports with required file and command evidence', () => {
    expect(
      evaluateTaskResultReport(
        task({
          targetPaths: ['src/server/foo.ts'],
          requiredCommands: [{ command: 'pnpm test src/server/foo.test.ts' }],
          requiredEvidence: ['测试命令 exitCode=0'],
        }),
        {
          status: 'complete',
          summary: 'Implemented foo. 测试命令 exitCode=0',
          filesChanged: [{ path: 'src/server/foo.ts', action: 'modified' }],
          commandsRun: [{ command: 'pnpm test src/server/foo.test.ts', exitCode: 0 }],
        },
        {
          fileWrites: [
            {
              path: 'src/server/foo.ts',
              absolutePath: 'E:/repo/src/server/foo.ts',
              bytes: 123,
              applied: 'auto',
            },
          ],
          commands: [
            {
              command: 'pnpm test src/server/foo.test.ts',
              cwd: 'E:/repo',
              exitCode: 0,
              timedOut: false,
              isError: false,
            },
          ],
        },
      ),
    ).toEqual({ ok: true })
  })

  it('fails complete reports missing required file or command evidence', () => {
    expect(
      evaluateTaskResultReport(
        task({
          targetPaths: ['src/server/foo.ts'],
          requiredCommands: [{ command: 'pnpm test src/server/foo.test.ts' }],
        }),
        {
          status: 'complete',
          summary: 'Done.',
        },
      ),
    ).toEqual({
      ok: false,
      error: 'Task "t1" report is missing target path evidence: src/server/foo.ts',
    })

    expect(
      evaluateTaskResultReport(
        task({
          requiredCommands: [{ command: 'pnpm test src/server/foo.test.ts' }],
        }),
        {
          status: 'complete',
          summary: 'Done.',
        },
      ),
    ).toEqual({
      ok: false,
      error:
        'Task "t1" report is missing successful command evidence: pnpm test src/server/foo.test.ts',
    })
  })

  it('fails complete reports when managed command evidence failed', () => {
    expect(
      evaluateTaskResultReport(
        task(),
        {
          status: 'complete',
          summary: 'Done.',
        },
        {
          fileWrites: [],
          commands: [
            {
              command: 'mvn compile',
              cwd: 'E:/repo',
              exitCode: 1,
              timedOut: false,
              isError: false,
            },
          ],
        },
      ),
    ).toEqual({
      ok: false,
      error: 'Task "t1" has failed command evidence: mvn compile (exit 1)',
    })
  })

  it('accepts when a failed managed command later succeeds', () => {
    expect(
      evaluateTaskResultReport(
        task({ requiredCommands: [{ command: 'pnpm build', cwd: 'frontend' }] }),
        {
          status: 'complete',
          summary: 'Build now passes.',
          commandsRun: [{ command: 'pnpm build', exitCode: 0, cwd: 'frontend' }],
        },
        {
          fileWrites: [],
          commands: [
            {
              command: 'pnpm build',
              cwd: 'E:/repo/frontend',
              exitCode: 1,
              timedOut: false,
              isError: false,
            },
            {
              command: 'pnpm build',
              cwd: 'E:/repo/frontend',
              exitCode: 0,
              timedOut: false,
              isError: false,
            },
          ],
        },
      ),
    ).toEqual({ ok: true })
  })

  it('does not let an earlier automatic prepare failure block later successful verification', () => {
    expect(
      evaluateTaskResultReport(
        task({ requiredCommands: [{ command: 'pnpm build', cwd: 'frontend' }] }),
        {
          status: 'complete',
          summary: 'Build passes after dependencies were prepared.',
          commandsRun: [{ command: 'pnpm build', exitCode: 0, cwd: 'frontend' }],
        },
        {
          fileWrites: [],
          commands: [
            {
              command: 'pnpm install',
              cwd: 'E:/repo/frontend',
              exitCode: 1,
              timedOut: false,
              isError: false,
              prepare: true,
            },
            {
              command: 'pnpm build',
              cwd: 'E:/repo/frontend',
              exitCode: 1,
              timedOut: false,
              isError: true,
              error: 'prepare command failed',
            },
            {
              command: 'pnpm build',
              cwd: 'E:/repo/frontend',
              exitCode: 0,
              timedOut: false,
              isError: false,
            },
          ],
        },
      ),
    ).toEqual({ ok: true })
  })
})
