import { useEffect, useMemo, useState } from 'react'
import { Home, Menu, Settings, X } from 'lucide-react'

import { createMobileApiClient } from './api/client'
import { ApprovalsScreen } from './screens/ApprovalsScreen'
import { ConversationsScreen } from './screens/ConversationsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { StatusScreen } from './screens/StatusScreen'
import { loadConnection, saveConnection } from './storage/connection'
import type {
  ConnectionConfig,
  MobileAskUserAnswers,
  MobileConversationDetail,
  MobileSnapshot,
} from './types'

const initialConnection = loadConnection()

type AppView = 'home' | 'settings'

export function App() {
  const [activeView, setActiveView] = useState<AppView>('home')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [connection, setConnection] = useState<ConnectionConfig>(initialConnection)
  const [snapshot, setSnapshot] = useState<MobileSnapshot | null>(null)
  const [conversationDetail, setConversationDetail] = useState<MobileConversationDetail | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [operationId, setOperationId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const api = useMemo(() => createMobileApiClient(connection), [connection])
  const connected = !!connection.baseUrl && !!connection.deviceToken

  useEffect(() => {
    saveConnection(connection)
  }, [connection])

  useEffect(() => {
    if (!connected || activeView === 'settings') return

    let cancelled = false

    async function refreshMobileSnapshot() {
      try {
        const next = await api.getSnapshot()
        if (!cancelled) setSnapshot(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    const timer = window.setInterval(() => {
      void refreshMobileSnapshot()
    }, 3000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [activeView, api, connected])

  useEffect(() => {
    if (!connected || !selectedConversationId) return

    let cancelled = false
    const conversationId = selectedConversationId

    async function refreshConversationDetail() {
      try {
        const next = await api.getConversation(conversationId)
        if (!cancelled) setConversationDetail(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      }
    }

    const timer = window.setInterval(() => {
      void refreshConversationDetail()
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [api, connected, selectedConversationId])

  async function refreshSnapshot() {
    if (!connected) {
      setError('请先在设置里填写桌面端地址和设备 token。')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await api.getSnapshot()
      setSnapshot(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function runMobileAction(id: string, action: () => Promise<void>) {
    if (!connected) {
      setError('请先在设置里填写桌面端地址和设备 token。')
      return
    }
    setOperationId(id)
    setError(null)
    try {
      await action()
      setSnapshot(await api.getSnapshot())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOperationId(null)
    }
  }

  async function openConversation(id: string) {
    if (!connected) {
      setError('请先在设置里填写桌面端地址和设备 token。')
      return
    }
    setSelectedConversationId(id)
    setActiveView('home')
    setDrawerOpen(false)
    setLoading(true)
    setError(null)
    try {
      setConversationDetail(await api.getConversation(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  function openHome() {
    setActiveView('home')
    setSelectedConversationId(null)
    setConversationDetail(null)
    setDrawerOpen(false)
  }

  function openSettings() {
    setActiveView('settings')
    setSelectedConversationId(null)
    setConversationDetail(null)
    setDrawerOpen(false)
  }

  async function sendMessageFromMobile(content: string) {
    if (!selectedConversationId) return
    await runMobileAction('send-message', async () => {
      await api.sendMessage(selectedConversationId, content)
      setConversationDetail(await api.getConversation(selectedConversationId))
    })
  }

  const hasPending = !!snapshot && (snapshot.pendingWrites.length > 0 || snapshot.pendingQuestions.length > 0)

  const content = selectedConversationId ? (
      <ConversationsScreen
        connected={connected}
        loading={loading}
        snapshot={snapshot}
        detail={conversationDetail}
        selectedConversationId={selectedConversationId}
        onOpenConversation={(id) => void openConversation(id)}
        onSendMessage={(content) => void sendMessageFromMobile(content)}
      />
    ) : activeView === 'settings' ? (
      <SettingsScreen
        connection={connection}
        loading={loading}
        error={error}
        onChange={setConnection}
        onTest={() => void refreshSnapshot()}
      />
    ) : (
      <div className="screen-stack">
        <StatusScreen
          connected={connected}
          loading={loading}
          error={error}
          snapshot={snapshot}
          onRefresh={() => void refreshSnapshot()}
          onOpenSettings={openSettings}
          onOpenConversation={(id) => void openConversation(id)}
        />
        {hasPending && (
          <ApprovalsScreen
            connected={connected}
            busyId={operationId}
            snapshot={snapshot}
            onWriteDecision={(id, action) =>
              void runMobileAction(id, () => api.decidePendingWrite(id, action))
            }
            onQuestionAnswer={(id, answers: MobileAskUserAnswers) =>
              void runMobileAction(id, () => api.answerPendingQuestion(id, answers))
            }
          />
        )}
      </div>
    )

  return (
    <main className="app-shell">
      <button
        type="button"
        className="chrome-button floating-menu-button"
        aria-label="打开侧边栏"
        onClick={() => setDrawerOpen(true)}
      >
        <Menu className="chrome-icon" aria-hidden="true" />
      </button>

      <div className="screen-frame">{content}</div>

      {drawerOpen && (
        <>
          <button type="button" className="drawer-backdrop" aria-label="关闭侧边栏" onClick={() => setDrawerOpen(false)} />
          <aside className="side-drawer" aria-label="侧边栏">
            <div className="drawer-header">
              <div>
                <p className="eyebrow">AgentHub</p>
                <h2>Companion</h2>
              </div>
              <button type="button" className="chrome-button" aria-label="关闭侧边栏" onClick={() => setDrawerOpen(false)}>
                <X className="chrome-icon" aria-hidden="true" />
              </button>
            </div>

            <div className="drawer-section">
              <button type="button" className="drawer-item active" onClick={openHome}>
                <Home className="drawer-icon" aria-hidden="true" />
                主页
              </button>
              <button type="button" className="drawer-item" onClick={openSettings}>
                <Settings className="drawer-icon" aria-hidden="true" />
                设置
              </button>
            </div>

            <div className="drawer-status">
              <span className={connected ? 'status-pill online' : 'status-pill'}>
                {connected ? '已配置' : '未配对'}
              </span>
              <p>
                {snapshot
                  ? `${snapshot.conversations.length} 个会话 · ${snapshot.runningRuns.length} 个运行中`
                  : '等待桌面端 snapshot'}
              </p>
            </div>
          </aside>
        </>
      )}
    </main>
  )
}
