import { ChevronRight, Link, RefreshCw } from 'lucide-react'

import type { MobileSnapshot } from '../types'

export function StatusScreen({
  connected,
  loading,
  error,
  snapshot,
  onRefresh,
  onOpenSettings,
  onOpenConversation,
}: {
  connected: boolean
  loading: boolean
  error: string | null
  snapshot: MobileSnapshot | null
  onRefresh: () => void
  onOpenSettings: () => void
  onOpenConversation: (id: string) => void
}) {
  const running = snapshot?.runningRuns.length ?? 0
  const pendingWrites = snapshot?.pendingWrites.length ?? 0
  const pendingQuestions = snapshot?.pendingQuestions.length ?? 0

  return (
    <div className="screen-stack">
      <section className="panel hero-panel">
        <div>
          <h2>{connected ? '桌面端连接已配置' : '连接桌面端 AgentHub'}</h2>
          <p>
            手机 App 作为 companion client，只负责观察、审批和反馈；Agent、工具和 workspace 仍在桌面端执行。
          </p>
        </div>
        <button type="button" className="primary-action" onClick={connected ? onRefresh : onOpenSettings}>
          {connected ? (
            <RefreshCw className="button-icon" aria-hidden="true" />
          ) : (
            <Link className="button-icon" aria-hidden="true" />
          )}
          {connected ? (loading ? '刷新中' : '刷新') : '去配对'}
        </button>
      </section>

      {error && <div className="error-banner">{error}</div>}

      <section className="metric-grid">
        <Metric label="运行中" value={running} />
        <Metric label="待审批" value={pendingWrites} />
        <Metric label="待回答" value={pendingQuestions} />
      </section>

      <section className="card-list">
        <h2 className="section-title">会话</h2>
        {snapshot && snapshot.conversations.length > 0 ? (
          snapshot.conversations.map((conv) => (
            <button
              key={conv.id}
              type="button"
              className="list-card conversation-button"
              onClick={() => onOpenConversation(conv.id)}
            >
              <AvatarBadge
                className="conversation-avatar"
                label={conversationAvatarLabel(conv.title, conv.mode)}
                toneKey={conv.id}
              />
              <div className="conversation-main">
                <div>
                  <h3>{conv.title}</h3>
                  <p>
                    {conv.mode === 'group' ? '群聊' : '单聊'} · {formatTime(conv.updatedAt)}
                  </p>
                </div>
                {(conv.runningRunCount > 0 || conv.pendingWriteCount > 0 || conv.pendingQuestionCount > 0) && (
                  <div className="conversation-badges">
                    {conv.runningRunCount > 0 && <span className="mini-pill">运行 {conv.runningRunCount}</span>}
                    {conv.pendingWriteCount > 0 && <span className="mini-pill">审批 {conv.pendingWriteCount}</span>}
                    {conv.pendingQuestionCount > 0 && <span className="mini-pill">提问 {conv.pendingQuestionCount}</span>}
                  </div>
                )}
              </div>
              <ChevronRight className="chevron-icon" aria-hidden="true" />
            </button>
          ))
        ) : (
          <EmptyState text={connected ? '暂无 snapshot 数据。' : '配对后会显示桌面端状态。'} />
        )}
      </section>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric-card">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>
}

function AvatarBadge({
  label,
  toneKey,
  className,
}: {
  label: string
  toneKey: string
  className?: string
}) {
  return <div className={`${className ?? ''} avatar-tone-${hashTone(toneKey)}`}>{label}</div>
}

function conversationAvatarLabel(title: string, mode: 'single' | 'group'): string {
  const fallback = mode === 'group' ? 'GR' : 'DM'
  return avatarInitials(title, fallback)
}

function avatarInitials(name: string, fallback: string): string {
  const normalized = name.trim()
  if (!normalized) return fallback

  const asciiWords = normalized.match(/[a-zA-Z0-9]+/g)
  if (asciiWords && asciiWords.length > 0) {
    const first = asciiWords[0]?.[0] ?? ''
    const second = asciiWords.length > 1 ? asciiWords[1]?.[0] : asciiWords[0]?.[1]
    return `${first}${second ?? ''}`.toUpperCase()
  }

  const chars = Array.from(normalized).filter((char) => /\p{Letter}|\p{Number}/u.test(char))
  return chars.slice(0, 2).join('').toUpperCase() || fallback
}

function hashTone(key: string): number {
  let hash = 0
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return hash % 7
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
