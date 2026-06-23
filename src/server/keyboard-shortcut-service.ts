import { asc, eq } from 'drizzle-orm'

import { db, schema } from '@/db/client'
import type { KeyboardShortcutRow, KeyboardShortcutScope } from '@/db/schema'
import { newKeyboardShortcutId } from '@/server/ids'

interface DefaultShortcut {
  scope: KeyboardShortcutScope
  action: string
  keys: string[]
  description: string
  preventDefault?: boolean
}

const defaultShortcuts: DefaultShortcut[] = [
  shortcut('global', 'open_command_palette', ['Ctrl', 'Shift', 'A'], 'Open command palette.'),
  shortcut('global', 'emergency_stop', ['Ctrl', 'Shift', 'X'], 'Emergency stop.'),
  shortcut('global', 'open_debug', ['Ctrl', 'Shift', 'D'], 'Open debug tools.'),
  shortcut('global', 'global_search', ['Ctrl', 'K'], 'Open search.'),
  shortcut('global', 'open_settings', ['Ctrl', 'Comma'], 'Open settings.'),
  shortcut('global', 'new_agent', ['Ctrl', 'Shift', 'N'], 'Create a new Agent.'),
  shortcut('global', 'new_workflow', ['Ctrl', 'Shift', 'W'], 'Create a new workflow.'),
  shortcut('global', 'new_task', ['Ctrl', 'Shift', 'T'], 'Create a new task.'),
  shortcut('global', 'close_overlay', ['Escape'], 'Close overlay or dialog.'),
  shortcut('canvas', 'pan_canvas', ['Space', 'Drag'], 'Pan canvas.'),
  shortcut('canvas', 'zoom_canvas', ['Ctrl', 'Wheel'], 'Zoom canvas.'),
  shortcut('canvas', 'delete_node', ['Delete'], 'Delete selected node.'),
  shortcut('canvas', 'copy_node', ['Ctrl', 'C'], 'Copy selected node.'),
  shortcut('canvas', 'paste_node', ['Ctrl', 'V'], 'Paste node.'),
  shortcut('canvas', 'undo_canvas', ['Ctrl', 'Z'], 'Undo canvas change.'),
  shortcut('canvas', 'redo_canvas', ['Ctrl', 'Y'], 'Redo canvas change.'),
  shortcut('canvas', 'select_all_nodes', ['Ctrl', 'A'], 'Select all canvas nodes.'),
  shortcut('canvas', 'group_nodes', ['Ctrl', 'G'], 'Group selected nodes.'),
  shortcut('run_monitor', 'pause_or_resume_run', ['Space'], 'Pause or resume run.'),
  shortcut('run_monitor', 'stop_run', ['Shift', 'Space'], 'Stop run.'),
  shortcut('run_monitor', 'open_artifacts', ['Ctrl', 'B'], 'Open artifacts.'),
  shortcut('run_monitor', 'open_memory', ['Ctrl', 'M'], 'Open memory.'),
  shortcut('run_monitor', 'previous_step', ['ArrowLeft'], 'Previous step.'),
  shortcut('run_monitor', 'next_step', ['ArrowRight'], 'Next step.'),
  shortcut('common', 'open_help', ['F1'], 'Open help.'),
  shortcut('common', 'toggle_fullscreen', ['F11'], 'Toggle fullscreen.'),
  ...Array.from({ length: 8 }, (_, index) =>
    shortcut('common', `switch_page_${index + 1}`, ['Ctrl', String(index + 1)], `Switch to page ${index + 1}.`),
  ),
]

export function getDefaultShortcutCount(): number {
  return defaultShortcuts.length
}

export async function seedKeyboardShortcuts(): Promise<KeyboardShortcutRow[]> {
  const now = Date.now()
  for (const item of defaultShortcuts) {
    const existing = await db.query.keyboardShortcuts.findFirst({
      where: eq(schema.keyboardShortcuts.action, item.action),
    })
    if (existing) continue
    await db.insert(schema.keyboardShortcuts).values({
      id: newKeyboardShortcutId(),
      scope: item.scope,
      action: item.action,
      keys: normalizeKeys(item.keys),
      description: item.description,
      preventDefault: item.preventDefault ?? true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    })
  }
  return listKeyboardShortcuts()
}

export async function listKeyboardShortcuts(args: {
  scope?: KeyboardShortcutScope
} = {}): Promise<KeyboardShortcutRow[]> {
  const rows = await db.query.keyboardShortcuts.findMany({
    where: args.scope ? eq(schema.keyboardShortcuts.scope, args.scope) : undefined,
    orderBy: [asc(schema.keyboardShortcuts.scope), asc(schema.keyboardShortcuts.action)],
    limit: 100,
  })
  return rows
}

export async function resolveKeyboardShortcut(args: {
  scope: KeyboardShortcutScope
  keys: string[]
}): Promise<{
  shortcut: KeyboardShortcutRow | null
  searchedScopes: KeyboardShortcutScope[]
}> {
  await seedKeyboardShortcuts()
  const searchedScopes: KeyboardShortcutScope[] =
    args.scope === 'common' ? ['common'] : [args.scope, 'common', 'global']
  const target = chord(normalizeKeys(args.keys))
  for (const scope of searchedScopes) {
    const rows = await listKeyboardShortcuts({ scope })
    const match = rows.find((row) => row.status === 'active' && chord(row.keys) === target)
    if (match) return { shortcut: match, searchedScopes }
  }
  return { shortcut: null, searchedScopes }
}

export async function detectKeyboardShortcutConflicts(): Promise<Array<{
  scope: KeyboardShortcutScope
  keys: string[]
  actions: string[]
}>> {
  const rows = (await seedKeyboardShortcuts()).filter((row) => row.status === 'active')
  const groups = new Map<string, KeyboardShortcutRow[]>()
  for (const row of rows) {
    const key = `${row.scope}:${chord(row.keys)}`
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()]
    .filter((items) => items.length > 1)
    .map((items) => ({
      scope: items[0].scope,
      keys: items[0].keys,
      actions: items.map((item) => item.action),
    }))
}

function shortcut(
  scope: KeyboardShortcutScope,
  action: string,
  keys: string[],
  description: string,
  preventDefault = true,
): DefaultShortcut {
  return { scope, action, keys, description, preventDefault }
}

function normalizeKeys(keys: string[]): string[] {
  return keys.map((key) => key.trim()).filter(Boolean)
}

function chord(keys: string[]): string {
  return normalizeKeys(keys).join('+').toLowerCase()
}
