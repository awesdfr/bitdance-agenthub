'use client'

import { useCallback, useState } from 'react'

import { AgentLibrary } from '@/components/agent-library'
import { AgentWorkflowCanvas } from '@/components/agent-workflow-canvas'
import { ArtifactLibrary } from '@/components/artifact-library'
import { ChatPanel } from '@/components/chat-panel'
import { ConfigOpsCenter } from '@/components/config-ops-center'
import { ModelControlCenter } from '@/components/model-control-center'
import { ObservabilityCenter } from '@/components/observability-center'
import { ProductionIntegrationsCenter } from '@/components/production-integrations-center'
import { Sidebar, type SidebarMode } from '@/components/sidebar'
import { SkillsCenter } from '@/components/skills-center'
import { TaskSchedulerCenter } from '@/components/task-scheduler-center'
import { ToolControlCenter } from '@/components/tool-control-center'
import { UsageDashboard } from '@/components/usage-dashboard'

export function AppShell() {
  const [mode, setMode] = useState<SidebarMode>('conversations')

  const handleModeChange = useCallback((nextMode: SidebarMode) => {
    setMode(nextMode)
  }, [])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <Sidebar mode={mode} onModeChange={handleModeChange} />
      <WorkspaceMain mode={mode} />
    </div>
  )
}

function WorkspaceMain({ mode }: { mode: SidebarMode }) {
  if (mode === 'conversations') {
    return <ChatPanel />
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
      {renderWorkspace(mode)}
    </main>
  )
}

function renderWorkspace(mode: SidebarMode) {
  switch (mode) {
    case 'artifacts':
      return <ArtifactLibrary />
    case 'agents':
      return <AgentLibrary />
    case 'employee-factory':
      return <AgentLibrary defaultSettingsOpen />
    case 'agent-canvas':
      return <AgentWorkflowCanvas />
    case 'skills':
      return <SkillsCenter />
    case 'scheduler':
      return <TaskSchedulerCenter />
    case 'memory':
    case 'context':
    case 'capabilities':
    case 'collaboration':
    case 'governance':
      return <AgentLibrary defaultSettingsOpen />
    case 'models':
      return <ModelControlCenter />
    case 'tools':
      return <ToolControlCenter />
    case 'monitor':
      return <ObservabilityCenter />
    case 'configops':
      return <ConfigOpsCenter />
    case 'production':
      return <ProductionIntegrationsCenter />
    case 'analytics':
      return <UsageDashboard />
    case 'conversations':
      return <ChatPanel />
  }
}
