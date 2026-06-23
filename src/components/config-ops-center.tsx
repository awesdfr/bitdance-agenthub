'use client'

import {
  Boxes,
  Download,
  GitBranch,
  Loader2,
  RefreshCw,
  Route,
  Save,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import type {
  AgentProfileRow,
  CliProfileRow,
  ConfigEntityType,
  ConfigExportFormat,
  ConfigExportRow,
  ConfigImpactAnalysisRow,
  ConfigVersionRow,
  EditConflictResolution,
  EditConflictRow,
  ExportPackageRow,
  ExportPackageType,
  JsonObject,
  McpServerRow,
  ModelProfileRow,
  NetworkProfileRow,
  OptimisticLockRow,
  PackageImportCheckRow,
  PlaybookRow,
  PromptTemplateRow,
  RecordedMacroRow,
  SoftwareCommandRow,
  SoftwareProfileRow,
  ToolConnectionRow,
  WorkflowRow,
} from '@/db/schema'
import {
  analyzeConfigImpact,
  applyConfigVersion,
  captureConfigVersion,
  commitOptimisticEdit,
  createConfigExport,
  createExportPackage,
  fetchAgentProfiles,
  fetchCliProfiles,
  fetchConfigExports,
  fetchConfigImpactAnalyses,
  fetchConfigVersions,
  fetchEditConflicts,
  fetchExportPackages,
  fetchMcpServers,
  fetchModelProfiles,
  fetchNetworkProfiles,
  fetchOptimisticLocks,
  fetchPackageImportChecks,
  fetchPlaybooks,
  fetchPromptTemplateCatalog,
  fetchRecordedMacros,
  fetchSoftwareCommands,
  fetchSoftwareProfiles,
  fetchToolConnections,
  fetchWorkflows,
  resolveEditConflict,
  runPackageImportCheck,
  startOptimisticEdit,
} from '@/lib/api'
import { cn } from '@/lib/utils'

const entityTypes: ConfigEntityType[] = [
  'agent_profile',
  'model_profile',
  'network_profile',
  'cli_profile',
  'mcp_server',
  'tool_connection',
  'software_profile',
  'software_command',
  'recorded_macro',
  'workflow',
  'prompt_template',
  'playbook',
]
const configSources: ConfigVersionRow['source'][] = [
  'manual',
  'api',
  'runtime_snapshot',
  'gitops_export',
]
const exportFormats: ConfigExportFormat[] = ['json', 'yaml', 'gitops_bundle']
const packageTypes: ExportPackageType[] = [
  'agent_profile',
  'workflow',
  'skill',
  'software_command',
  'recorded_macro',
]

type EntityOption = {
  id: string
  label: string
}

type SavingAction =
  | 'capture'
  | 'apply'
  | 'export'
  | 'impact'
  | 'optimistic-start'
  | 'optimistic-commit'
  | 'conflict-resolve'
  | 'share-package'
  | 'import-check'
  | null

export function ConfigOpsCenter() {
  const [agents, setAgents] = useState<AgentProfileRow[]>([])
  const [models, setModels] = useState<ModelProfileRow[]>([])
  const [networks, setNetworks] = useState<NetworkProfileRow[]>([])
  const [cliProfiles, setCliProfiles] = useState<CliProfileRow[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerRow[]>([])
  const [toolConnections, setToolConnections] = useState<ToolConnectionRow[]>([])
  const [softwareProfiles, setSoftwareProfiles] = useState<SoftwareProfileRow[]>([])
  const [softwareCommands, setSoftwareCommands] = useState<SoftwareCommandRow[]>([])
  const [recordedMacros, setRecordedMacros] = useState<RecordedMacroRow[]>([])
  const [workflows, setWorkflows] = useState<WorkflowRow[]>([])
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplateRow[]>([])
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([])
  const [versions, setVersions] = useState<ConfigVersionRow[]>([])
  const [exports, setExports] = useState<ConfigExportRow[]>([])
  const [impacts, setImpacts] = useState<ConfigImpactAnalysisRow[]>([])
  const [optimisticLocks, setOptimisticLocks] = useState<OptimisticLockRow[]>([])
  const [editConflicts, setEditConflicts] = useState<EditConflictRow[]>([])
  const [exportPackages, setExportPackages] = useState<ExportPackageRow[]>([])
  const [packageImportChecks, setPackageImportChecks] = useState<PackageImportCheckRow[]>([])

  const [entityType, setEntityType] = useState<ConfigEntityType>('agent_profile')
  const [entityId, setEntityId] = useState('')
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [versionDraft, setVersionDraft] = useState({
    source: 'manual' as ConfigVersionRow['source'],
    changeSummary: 'Manual snapshot from ConfigOps Center.',
    createdBy: 'local-user',
  })
  const [exportDraft, setExportDraft] = useState({
    name: 'AgentHub config bundle',
    format: 'gitops_bundle' as ConfigExportFormat,
    useSelectedVersion: false,
  })
  const [impactDraft, setImpactDraft] = useState({
    proposedSnapshotText: '',
  })
  const [optimisticDraft, setOptimisticDraft] = useState({
    baseVersion: '',
    proposedSnapshotText: '',
    changedFieldsText: 'name',
    editedBy: 'local-user',
  })
  const [conflictDraft, setConflictDraft] = useState({
    resolution: 'show_diff' as EditConflictResolution,
    mergedSnapshotText: '',
    resolvedBy: 'local-user',
  })
  const [packageDraft, setPackageDraft] = useState({
    packageType: 'agent_profile' as ExportPackageType,
    name: 'Shareable Agent package',
    author: 'local-user',
    description: '',
    packageVersion: '1.0.0',
    tagsText: 'agenthub',
    includeMemories: false,
    includeSampleArtifacts: false,
    includeBenchmarkResults: false,
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<SavingAction>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const entityOptionsByType = useMemo(
    () => ({
      agent_profile: agents.map((item) => option(item.id, item.name)),
      model_profile: models.map((item) => option(item.id, item.name)),
      network_profile: networks.map((item) => option(item.id, item.name)),
      cli_profile: cliProfiles.map((item) => option(item.id, item.name)),
      mcp_server: mcpServers.map((item) => option(item.id, item.displayName)),
      tool_connection: toolConnections.map((item) => option(item.id, item.displayName)),
      software_profile: softwareProfiles.map((item) => option(item.id, item.name)),
      software_command: softwareCommands.map((item) => option(item.id, item.name)),
      recorded_macro: recordedMacros.map((item) => option(item.id, item.name)),
      workflow: workflows.map((item) => option(item.id, item.name)),
      prompt_template: promptTemplates.map((item) => option(item.id, item.name)),
      playbook: playbooks.map((item) => option(item.id, item.title)),
    }),
    [
      agents,
      cliProfiles,
      mcpServers,
      models,
      networks,
      playbooks,
      promptTemplates,
      recordedMacros,
      softwareCommands,
      softwareProfiles,
      toolConnections,
      workflows,
    ],
  )
  const entityOptions = entityOptionsByType[entityType] ?? []
  const selectedEntityLabel =
    entityOptions.find((item) => item.id === entityId)?.label ?? (entityId || 'No entity selected')
  const latestVersion = versions[0] ?? null
  const latestExport = exports[0] ?? null
  const latestImpact = impacts[0] ?? null
  const latestOpenConflict = editConflicts.find((conflict) => conflict.status === 'open') ?? null
  const openConflictCount = editConflicts.filter((conflict) => conflict.status === 'open').length
  const latestPackage = exportPackages[0] ?? null

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [
        agentsNext,
        modelsNext,
        networksNext,
        cliNext,
        mcpNext,
        toolsNext,
        softwareNext,
        commandsNext,
        macrosNext,
        workflowsNext,
        promptCatalog,
        playbooksNext,
        versionsNext,
        exportsNext,
        impactsNext,
        locksNext,
        conflictsNext,
        packagesNext,
        packageChecksNext,
      ] = await Promise.all([
        fetchAgentProfiles(),
        fetchModelProfiles(),
        fetchNetworkProfiles(),
        fetchCliProfiles(),
        fetchMcpServers(),
        fetchToolConnections(),
        fetchSoftwareProfiles(),
        fetchSoftwareCommands(),
        fetchRecordedMacros(),
        fetchWorkflows(),
        fetchPromptTemplateCatalog(),
        fetchPlaybooks(),
        fetchConfigVersions({
          entityType,
          entityId: entityId || undefined,
          limit: 100,
        }),
        fetchConfigExports(100),
        fetchConfigImpactAnalyses({
          entityType,
          entityId: entityId || undefined,
          limit: 100,
        }),
        fetchOptimisticLocks({
          entityType,
          entityId: entityId || undefined,
          limit: 50,
        }),
        fetchEditConflicts({
          entityType,
          entityId: entityId || undefined,
          limit: 50,
        }),
        fetchExportPackages(50),
        fetchPackageImportChecks(50),
      ])
      setAgents(agentsNext)
      setModels(modelsNext)
      setNetworks(networksNext)
      setCliProfiles(cliNext)
      setMcpServers(mcpNext)
      setToolConnections(toolsNext)
      setSoftwareProfiles(softwareNext)
      setSoftwareCommands(commandsNext)
      setRecordedMacros(macrosNext)
      setWorkflows(workflowsNext)
      setPromptTemplates(promptCatalog.promptTemplates)
      setPlaybooks(playbooksNext)
      setVersions(versionsNext)
      setExports(exportsNext)
      setImpacts(impactsNext)
      setOptimisticLocks(locksNext)
      setEditConflicts(conflictsNext)
      setExportPackages(packagesNext)
      setPackageImportChecks(packageChecksNext)
      const nextOptions = buildOptionsForType(entityType, {
        agents: agentsNext,
        models: modelsNext,
        networks: networksNext,
        cliProfiles: cliNext,
        mcpServers: mcpNext,
        toolConnections: toolsNext,
        softwareProfiles: softwareNext,
        softwareCommands: commandsNext,
        recordedMacros: macrosNext,
        workflows: workflowsNext,
        promptTemplates: promptCatalog.promptTemplates,
        playbooks: playbooksNext,
      })
      setEntityId((current) =>
        current && nextOptions.some((item) => item.id === current) ? current : nextOptions[0]?.id ?? '',
      )
      setSelectedVersionId((current) =>
        current && versionsNext.some((version) => version.id === current)
          ? current
          : versionsNext[0]?.id ?? '',
      )
      setOptimisticDraft((draft) => ({
        ...draft,
        baseVersion: draft.baseVersion || (locksNext[0]?.entityVersion ? String(locksNext[0].entityVersion) : ''),
        proposedSnapshotText:
          draft.proposedSnapshotText || (locksNext[0]?.snapshot ? JSON.stringify(locksNext[0].snapshot, null, 2) : ''),
      }))
    } catch (err) {
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }, [entityId, entityType])

  useEffect(() => {
    void reload()
  }, [reload])

  const withAction = async (action: SavingAction, work: () => Promise<string>) => {
    setSaving(action)
    setError(null)
    setNotice(null)
    try {
      const message = await work()
      setNotice(message)
      await reload()
    } catch (err) {
      setError(formatError(err))
    } finally {
      setSaving(null)
    }
  }

  const captureVersion = () =>
    withAction('capture', async () => {
      requireEntity(entityId)
      const version = await captureConfigVersion({
        entityType,
        entityId,
        source: versionDraft.source,
        changeSummary: versionDraft.changeSummary,
        createdBy: versionDraft.createdBy || null,
      })
      return `Captured v${version.version} for ${version.displayName}`
    })

  const exportConfig = () =>
    withAction('export', async () => {
      requireEntity(entityId)
      const configExport = await createConfigExport({
        name: exportDraft.name,
        format: exportDraft.format,
        entityRefs: [
          {
            entityType,
            entityId,
            versionId: exportDraft.useSelectedVersion ? selectedVersionId || null : null,
          },
        ],
      })
      return `Exported ${configExport.format} bundle`
    })

  const applyVersion = () =>
    withAction('apply', async () => {
      requireEntity(entityId)
      if (!selectedVersionId) throw new Error('Select a config version to restore.')
      const result = await applyConfigVersion(selectedVersionId, {
        appliedBy: versionDraft.createdBy || 'local-user',
        changeSummary: `Rollback snapshot before restoring ${selectedVersionId} from ConfigOps Center.`,
      })
      return `${result.summary} Rollback v${result.rollbackVersion.version} is ready.`
    })

  const analyzeImpact = () =>
    withAction('impact', async () => {
      requireEntity(entityId)
      const impact = await analyzeConfigImpact({
        entityType,
        entityId,
        baseVersionId: selectedVersionId || null,
        proposedSnapshot: impactDraft.proposedSnapshotText.trim()
          ? parseJsonObject(impactDraft.proposedSnapshotText, 'Proposed snapshot')
          : null,
      })
      return `Impact ${impact.impactLevel}`
    })

  const startOptimisticSession = () =>
    withAction('optimistic-start', async () => {
      requireEntity(entityId)
      const lock = await startOptimisticEdit({
        entityType,
        entityId,
        editedBy: optimisticDraft.editedBy || null,
      })
      setOptimisticDraft((draft) => ({
        ...draft,
        baseVersion: String(lock.entityVersion),
        proposedSnapshotText: JSON.stringify(lock.snapshot, null, 2),
      }))
      return `Edit session v${lock.entityVersion} started`
    })

  const commitOptimisticSession = () =>
    withAction('optimistic-commit', async () => {
      requireEntity(entityId)
      const result = await commitOptimisticEdit({
        entityType,
        entityId,
        baseVersion: Number(optimisticDraft.baseVersion),
        proposedSnapshot: parseJsonObject(optimisticDraft.proposedSnapshotText, 'Proposed optimistic snapshot'),
        changedFields: lines(optimisticDraft.changedFieldsText),
        editedBy: optimisticDraft.editedBy || null,
      })
      if (result.status === 'conflict') {
        return `Edit conflict: server v${result.lock.entityVersion}, your v${optimisticDraft.baseVersion}`
      }
      return `Committed optimistic edit v${result.lock.entityVersion}`
    })

  const resolveLatestConflict = () =>
    withAction('conflict-resolve', async () => {
      if (!latestOpenConflict) throw new Error('No open conflict to resolve.')
      const conflict = await resolveEditConflict(latestOpenConflict.id, {
        resolution: conflictDraft.resolution,
        mergedSnapshot: conflictDraft.mergedSnapshotText.trim()
          ? parseJsonObject(conflictDraft.mergedSnapshotText, 'Merged snapshot')
          : null,
        resolvedBy: conflictDraft.resolvedBy || null,
      })
      return `Conflict resolved as ${conflict.resolution}`
    })

  const createSharePackage = () =>
    withAction('share-package', async () => {
      requireEntity(entityId)
      const pkg = await createExportPackage({
        packageType: packageDraft.packageType,
        sourceEntityId: entityId,
        name: packageDraft.name || selectedEntityLabel,
        author: packageDraft.author || null,
        description: packageDraft.description,
        packageVersion: packageDraft.packageVersion,
        tags: lines(packageDraft.tagsText),
        includes: {
          memories: packageDraft.includeMemories,
          sampleArtifacts: packageDraft.includeSampleArtifacts,
          benchmarkResults: packageDraft.includeBenchmarkResults,
        },
      })
      return `Created ${pkg.fileName}`
    })

  const checkLatestPackage = () =>
    withAction('import-check', async () => {
      if (!latestPackage) throw new Error('Create a share package first.')
      const check = await runPackageImportCheck(latestPackage.id)
      return `Import check ${check.compatibilityStatus}`
    })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch className="size-4" />
              <span className="truncate">ConfigOps Center</span>
            </div>
            <div className="mt-1 grid grid-cols-9 gap-1 text-[10px] text-muted-foreground">
              <Metric label="entities" value={entityOptions.length} />
              <Metric label="versions" value={versions.length} />
              <Metric label="exports" value={exports.length} />
              <Metric label="impacts" value={impacts.length} />
              <Metric label="latest" value={latestVersion?.version ?? 0} />
              <Metric label="locks" value={optimisticLocks.length} />
              <Metric label="conflicts" value={openConflictCount} />
              <Metric label="packages" value={exportPackages.length} />
              <Metric label="checks" value={packageImportChecks.length} />
            </div>
          </div>
          <Button size="icon" variant="ghost" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
          </Button>
        </div>
        {(error || notice) && (
          <div
            className={cn(
              'mt-2 rounded-md border px-2 py-1.5 text-[11px]',
              error
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
            )}
          >
            {error ?? notice}
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[19rem_1fr]">
        <ScrollArea className="min-h-0 border-r">
          <div className="space-y-3 p-3">
            <Section title="Entity" icon={<Boxes className="size-3.5" />}>
              <Select
                value={entityType}
                onChange={(value) => {
                  const nextType = value as ConfigEntityType
                  setEntityType(nextType)
                  setEntityId('')
                  setSelectedVersionId('')
                }}
                options={entityTypes}
              />
              <Select
                value={entityId}
                onChange={setEntityId}
                options={entityOptions.map((item) => item.id)}
                labels={Object.fromEntries(entityOptions.map((item) => [item.id, item.label]))}
                emptyLabel="Select entity"
              />
              <Hint>{selectedEntityLabel}</Hint>
            </Section>

            <Section title="Capture Version" icon={<Save className="size-3.5" />}>
              <Select
                value={versionDraft.source}
                onChange={(value) =>
                  setVersionDraft((draft) => ({
                    ...draft,
                    source: value as ConfigVersionRow['source'],
                  }))
                }
                options={configSources}
              />
              <Input
                value={versionDraft.createdBy}
                onChange={(event) =>
                  setVersionDraft((draft) => ({ ...draft, createdBy: event.target.value }))
                }
                placeholder="Created by"
              />
              <Textarea
                className="min-h-16 text-xs"
                value={versionDraft.changeSummary}
                onChange={(event) =>
                  setVersionDraft((draft) => ({
                    ...draft,
                    changeSummary: event.target.value,
                  }))
                }
                placeholder="Change summary"
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void captureVersion()}
                disabled={saving !== null || !entityId}
              >
                {saving === 'capture' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Capture Version
              </Button>
            </Section>

            <Section title="Restore Version" icon={<RefreshCw className="size-3.5" />}>
              <Select
                value={selectedVersionId}
                onChange={setSelectedVersionId}
                options={versions.map((version) => version.id)}
                labels={Object.fromEntries(
                  versions.map((version) => [
                    version.id,
                    `v${version.version} ${version.displayName} ${version.contentHash.slice(0, 8)}`,
                  ]),
                )}
                emptyLabel="Select version"
              />
              <Hint>
                Restores the selected snapshot into live local config and captures the current state first.
              </Hint>
              <Button
                className="h-8 w-full gap-1"
                variant="outline"
                onClick={() => void applyVersion()}
                disabled={saving !== null || !selectedVersionId}
              >
                {saving === 'apply' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                Restore Selected Version
              </Button>
            </Section>

            <Section title="Export Bundle" icon={<Download className="size-3.5" />}>
              <Input
                value={exportDraft.name}
                onChange={(event) =>
                  setExportDraft((draft) => ({ ...draft, name: event.target.value }))
                }
                placeholder="Export name"
              />
              <Select
                value={exportDraft.format}
                onChange={(value) =>
                  setExportDraft((draft) => ({ ...draft, format: value as ConfigExportFormat }))
                }
                options={exportFormats}
              />
              <Select
                value={selectedVersionId}
                onChange={setSelectedVersionId}
                options={versions.map((version) => version.id)}
                labels={Object.fromEntries(
                  versions.map((version) => [version.id, `v${version.version} ${version.contentHash.slice(0, 8)}`]),
                )}
                emptyLabel="Latest or new capture"
              />
              <Toggle
                label="Use selected version"
                checked={exportDraft.useSelectedVersion}
                onChange={(checked) =>
                  setExportDraft((draft) => ({ ...draft, useSelectedVersion: checked }))
                }
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void exportConfig()}
                disabled={saving !== null || !entityId || !exportDraft.name.trim()}
              >
                {saving === 'export' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Download className="size-3.5" />
                )}
                Export Config
              </Button>
            </Section>

            <Section title="Share Package" icon={<Download className="size-3.5" />}>
              <Select
                value={packageDraft.packageType}
                onChange={(value) =>
                  setPackageDraft((draft) => ({ ...draft, packageType: value as ExportPackageType }))
                }
                options={packageTypes}
              />
              <Input
                value={packageDraft.name}
                onChange={(event) =>
                  setPackageDraft((draft) => ({ ...draft, name: event.target.value }))
                }
                placeholder="Package name"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={packageDraft.author}
                  onChange={(event) =>
                    setPackageDraft((draft) => ({ ...draft, author: event.target.value }))
                  }
                  placeholder="Author"
                />
                <Input
                  value={packageDraft.packageVersion}
                  onChange={(event) =>
                    setPackageDraft((draft) => ({ ...draft, packageVersion: event.target.value }))
                  }
                  placeholder="Version"
                />
              </div>
              <Textarea
                className="min-h-16 text-xs"
                value={packageDraft.description}
                onChange={(event) =>
                  setPackageDraft((draft) => ({ ...draft, description: event.target.value }))
                }
                placeholder="Package description"
              />
              <Input
                value={packageDraft.tagsText}
                onChange={(event) =>
                  setPackageDraft((draft) => ({ ...draft, tagsText: event.target.value }))
                }
                placeholder="Tags"
              />
              <div className="grid grid-cols-3 gap-1">
                <Toggle
                  label="Memory"
                  checked={packageDraft.includeMemories}
                  onChange={(checked) =>
                    setPackageDraft((draft) => ({ ...draft, includeMemories: checked }))
                  }
                />
                <Toggle
                  label="Samples"
                  checked={packageDraft.includeSampleArtifacts}
                  onChange={(checked) =>
                    setPackageDraft((draft) => ({ ...draft, includeSampleArtifacts: checked }))
                  }
                />
                <Toggle
                  label="Benchmarks"
                  checked={packageDraft.includeBenchmarkResults}
                  onChange={(checked) =>
                    setPackageDraft((draft) => ({ ...draft, includeBenchmarkResults: checked }))
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="h-8 gap-1"
                  onClick={() => void createSharePackage()}
                  disabled={saving !== null || !entityId || !packageDraft.name.trim()}
                >
                  {saving === 'share-package' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                  Create Package
                </Button>
                <Button
                  className="h-8 gap-1"
                  variant="outline"
                  onClick={() => void checkLatestPackage()}
                  disabled={saving !== null || !latestPackage}
                >
                  {saving === 'import-check' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Route className="size-3.5" />
                  )}
                  Import Check
                </Button>
              </div>
            </Section>

            <Section title="Impact Analysis" icon={<Route className="size-3.5" />}>
              <Textarea
                className="min-h-24 text-xs"
                value={impactDraft.proposedSnapshotText}
                onChange={(event) =>
                  setImpactDraft((draft) => ({
                    ...draft,
                    proposedSnapshotText: event.target.value,
                  }))
                }
                placeholder="Optional proposed snapshot JSON"
              />
              <Button
                className="h-8 w-full gap-1"
                onClick={() => void analyzeImpact()}
                disabled={saving !== null || !entityId}
              >
                {saving === 'impact' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Route className="size-3.5" />
                )}
                Analyze Impact
              </Button>
            </Section>

            <Section title="Optimistic Edit" icon={<GitBranch className="size-3.5" />}>
              <Input
                value={optimisticDraft.editedBy}
                onChange={(event) =>
                  setOptimisticDraft((draft) => ({ ...draft, editedBy: event.target.value }))
                }
                placeholder="Edited by"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={optimisticDraft.baseVersion}
                  onChange={(event) =>
                    setOptimisticDraft((draft) => ({ ...draft, baseVersion: event.target.value }))
                  }
                  placeholder="Base version"
                  type="number"
                />
                <Input
                  value={optimisticDraft.changedFieldsText}
                  onChange={(event) =>
                    setOptimisticDraft((draft) => ({
                      ...draft,
                      changedFieldsText: event.target.value,
                    }))
                  }
                  placeholder="Changed fields"
                />
              </div>
              <Textarea
                className="min-h-28 text-xs"
                value={optimisticDraft.proposedSnapshotText}
                onChange={(event) =>
                  setOptimisticDraft((draft) => ({
                    ...draft,
                    proposedSnapshotText: event.target.value,
                  }))
                }
                placeholder="Proposed snapshot JSON"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="h-8 gap-1"
                  variant="outline"
                  onClick={() => void startOptimisticSession()}
                  disabled={saving !== null || !entityId}
                >
                  {saving === 'optimistic-start' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <GitBranch className="size-3.5" />
                  )}
                  Start Edit
                </Button>
                <Button
                  className="h-8 gap-1"
                  onClick={() => void commitOptimisticSession()}
                  disabled={saving !== null || !entityId || !optimisticDraft.baseVersion}
                >
                  {saving === 'optimistic-commit' ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Save className="size-3.5" />
                  )}
                  Commit Edit
                </Button>
              </div>
              <Select
                value={conflictDraft.resolution}
                onChange={(value) =>
                  setConflictDraft((draft) => ({
                    ...draft,
                    resolution: value as EditConflictResolution,
                  }))
                }
                options={['show_diff', 'merge', 'overwrite', 'discard']}
              />
              <Textarea
                className="min-h-20 text-xs"
                value={conflictDraft.mergedSnapshotText}
                onChange={(event) =>
                  setConflictDraft((draft) => ({
                    ...draft,
                    mergedSnapshotText: event.target.value,
                  }))
                }
                placeholder="Optional merged snapshot JSON"
              />
              <Button
                className="h-8 w-full gap-1"
                variant="outline"
                onClick={() => void resolveLatestConflict()}
                disabled={saving !== null || !latestOpenConflict}
              >
                {saving === 'conflict-resolve' ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <GitBranch className="size-3.5" />
                )}
                Resolve Latest Conflict
              </Button>
            </Section>
          </div>
        </ScrollArea>

        <ScrollArea className="min-h-0">
          <div className="space-y-3 p-3">
            <Section title="Versions" icon={<Save className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {versions.length === 0 ? (
                  <EmptyState label="No config versions" />
                ) : (
                  versions.slice(0, 24).map((version) => (
                    <EntityRow
                      key={version.id}
                      title={`v${version.version} ${version.displayName}`}
                      subtitle={version.changeSummary || jsonPreview(version.snapshot)}
                      badge={version.source}
                      meta={`${version.entityType} 路 ${version.contentHash.slice(0, 12)} 路 ${formatTime(version.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Exports" icon={<Download className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {exports.length === 0 ? (
                  <EmptyState label="No config exports" />
                ) : (
                  exports.slice(0, 20).map((item) => (
                    <EntityRow
                      key={item.id}
                      title={item.name}
                      subtitle={jsonPreview(item.entityRefs)}
                      badge={item.format}
                      meta={`${item.contentHash.slice(0, 12)} 路 ${formatTime(item.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Share Packages" icon={<Download className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {exportPackages.length === 0 ? (
                  <EmptyState label="No share packages" />
                ) : (
                  exportPackages.slice(0, 20).map((pkg) => (
                    <EntityRow
                      key={pkg.id}
                      title={pkg.fileName}
                      subtitle={`${pkg.packageType} from ${pkg.sourceEntityType}:${pkg.sourceEntityId}`}
                      badge={pkg.status}
                      meta={`${pkg.contentHash.slice(0, 12)} 璺?${formatTime(pkg.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Package Import Checks" icon={<Route className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {packageImportChecks.length === 0 ? (
                  <EmptyState label="No package import checks" />
                ) : (
                  packageImportChecks.slice(0, 20).map((check) => (
                    <EntityRow
                      key={check.id}
                      title={check.sourceFileName}
                      subtitle={check.summary}
                      badge={check.compatibilityStatus}
                      meta={`${check.missingSkills.length} skills / ${check.missingModels.length} models / ${check.missingSoftware.length} software`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Impact Analyses" icon={<Route className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {impacts.length === 0 ? (
                  <EmptyState label="No impact analyses" />
                ) : (
                  impacts.slice(0, 20).map((impact) => (
                    <EntityRow
                      key={impact.id}
                      title={impact.summary}
                      subtitle={jsonPreview(impact.impactedRefs)}
                      badge={impact.impactLevel}
                      meta={`${impact.entityType} 路 ${impact.proposedHash.slice(0, 12)} 路 ${formatTime(impact.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Optimistic Locks" icon={<GitBranch className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {optimisticLocks.length === 0 ? (
                  <EmptyState label="No optimistic locks" />
                ) : (
                  optimisticLocks.slice(0, 20).map((lock) => (
                    <EntityRow
                      key={lock.id}
                      title={`${lock.displayName} v${lock.entityVersion}`}
                      subtitle={`${lock.entityType}:${lock.entityId}`}
                      badge="lock"
                      meta={`${lock.contentHash.slice(0, 12)} 璺?${formatTime(lock.updatedAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Edit Conflicts" icon={<GitBranch className="size-3.5" />}>
              <div className="grid grid-cols-2 gap-2">
                {editConflicts.length === 0 ? (
                  <EmptyState label="No edit conflicts" />
                ) : (
                  editConflicts.slice(0, 20).map((conflict) => (
                    <EntityRow
                      key={conflict.id}
                      title={`${conflict.entityType}:${conflict.entityId}`}
                      subtitle={`your v${conflict.yourVersion} / server v${conflict.serverVersion} / fields ${conflict.conflictingFields.join(', ') || 'unknown'}`}
                      badge={conflict.status}
                      meta={`${conflict.resolution} 璺?${formatTime(conflict.createdAt)}`}
                    />
                  ))
                )}
              </div>
            </Section>

            <Section title="Selected Snapshot" icon={<Boxes className="size-3.5" />}>
              {latestVersion ? (
                <div className="rounded-lg border bg-background p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">
                      {latestVersion.displayName} v{latestVersion.version}
                    </div>
                    <StatusBadge value={latestVersion.source} />
                  </div>
                  <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 text-[10px] text-muted-foreground">
                    {JSON.stringify(latestVersion.snapshot, null, 2)}
                  </pre>
                </div>
              ) : (
                <EmptyState label="Capture a version to inspect a snapshot" />
              )}
            </Section>

            <Section title="Latest Export Bundle" icon={<Download className="size-3.5" />}>
              {latestExport ? (
                <div className="rounded-lg border bg-background p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">{latestExport.name}</div>
                    <StatusBadge value={latestExport.format} />
                  </div>
                  <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 text-[10px] text-muted-foreground">
                    {JSON.stringify(latestExport.bundle, null, 2)}
                  </pre>
                </div>
              ) : (
                <EmptyState label="No export bundle yet" />
              )}
            </Section>

            {latestImpact && (
              <Section title="Latest Impact" icon={<Route className="size-3.5" />}>
                <EntityRow
                  title={latestImpact.impactLevel}
                  subtitle={latestImpact.summary}
                  badge={latestImpact.impactLevel}
                  meta={`${latestImpact.impactedRefs.length} impacted refs`}
                />
              </Section>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function buildOptionsForType(
  entityType: ConfigEntityType,
  data: {
    agents: AgentProfileRow[]
    models: ModelProfileRow[]
    networks: NetworkProfileRow[]
    cliProfiles: CliProfileRow[]
    mcpServers: McpServerRow[]
    toolConnections: ToolConnectionRow[]
    softwareProfiles: SoftwareProfileRow[]
    softwareCommands: SoftwareCommandRow[]
    recordedMacros: RecordedMacroRow[]
    workflows: WorkflowRow[]
    promptTemplates: PromptTemplateRow[]
    playbooks: PlaybookRow[]
  },
): EntityOption[] {
  const map: Record<ConfigEntityType, EntityOption[]> = {
    agent_profile: data.agents.map((item) => option(item.id, item.name)),
    model_profile: data.models.map((item) => option(item.id, item.name)),
    network_profile: data.networks.map((item) => option(item.id, item.name)),
    cli_profile: data.cliProfiles.map((item) => option(item.id, item.name)),
    mcp_server: data.mcpServers.map((item) => option(item.id, item.displayName)),
    tool_connection: data.toolConnections.map((item) => option(item.id, item.displayName)),
    software_profile: data.softwareProfiles.map((item) => option(item.id, item.name)),
    software_command: data.softwareCommands.map((item) => option(item.id, item.name)),
    recorded_macro: data.recordedMacros.map((item) => option(item.id, item.name)),
    workflow: data.workflows.map((item) => option(item.id, item.name)),
    prompt_template: data.promptTemplates.map((item) => option(item.id, item.name)),
    playbook: data.playbooks.map((item) => option(item.id, item.title)),
  }
  return map[entityType] ?? []
}

function option(id: string, label: string): EntityOption {
  return { id, label }
}

function requireEntity(entityId: string) {
  if (!entityId) throw new Error('Select a configuration entity first.')
}

function Section({
  title,
  icon,
  children,
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-lg border bg-background/60 p-2.5">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
        {icon}
        <span>{title}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-1.5 py-1">
      <div className="truncate uppercase">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function EntityRow({
  title,
  subtitle,
  badge,
  meta,
}: {
  title: string
  subtitle: string
  badge: string
  meta: string
}) {
  return (
    <div className="rounded-lg border bg-background p-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{title}</div>
          <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <StatusBadge value={badge} />
      </div>
      <div className="mt-2 truncate text-[10px] text-muted-foreground">{meta}</div>
    </div>
  )
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      {label}
    </div>
  )
}

function StatusBadge({ value }: { value: string }) {
  const tone =
    value === 'manual' ||
    value === 'api' ||
    value === 'json' ||
    value === 'none' ||
    value === 'ready' ||
    value === 'compatible' ||
    value === 'low'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
      : value === 'high'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  return (
    <Badge variant="outline" className={cn('h-5 shrink-0 px-1.5 text-[10px]', tone)}>
      {value}
    </Badge>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-8 items-center justify-center rounded-lg border px-2 text-[11px] transition',
        checked ? 'border-foreground/30 bg-accent text-foreground' : 'bg-background text-muted-foreground',
      )}
    >
      {label}
    </button>
  )
}

function Select({
  value,
  onChange,
  options,
  labels,
  emptyLabel,
}: {
  value: string
  onChange: (value: string) => void
  options: string[]
  labels?: Record<string, string>
  emptyLabel?: string
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs outline-none focus-visible:border-ring"
    >
      {emptyLabel && <option value="">{emptyLabel}</option>}
      {options.map((item) => (
        <option key={item} value={item}>
          {labels?.[item] ?? item}
        </option>
      ))}
    </select>
  )
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="rounded-md bg-muted px-2 py-1.5 text-[11px] text-muted-foreground">{children}</div>
}

function parseJsonObject(text: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(text || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`)
    }
    return parsed as JsonObject
  } catch (err) {
    throw new Error(`${label} must be valid JSON: ${formatError(err)}`)
  }
}

function lines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter(Boolean)
}

function jsonPreview(value: unknown): string {
  const text =
    typeof value === 'string'
      ? value
      : (() => {
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        })()
  return text.length > 140 ? `${text.slice(0, 140)}...` : text
}

function formatTime(value: number | null | undefined): string {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
