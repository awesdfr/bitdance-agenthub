import { isValidElement, useState, type ReactNode } from 'react'
import {
  Bot,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code2,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Send,
  Wrench,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type {
  MobileAgent,
  MobileConversationDetail,
  MobileMessage,
  MobileMessagePart,
  MobileSnapshot,
} from '../types'

export function ConversationsScreen({
  connected,
  loading,
  snapshot,
  detail,
  selectedConversationId,
  onOpenConversation,
  onSendMessage,
}: {
  connected: boolean
  loading: boolean
  snapshot: MobileSnapshot | null
  detail: MobileConversationDetail | null
  selectedConversationId: string | null
  onOpenConversation: (id: string) => void
  onSendMessage: (content: string) => void
}) {
  const [draft, setDraft] = useState('')
  const agentById = new Map((snapshot?.agents ?? []).map((agent) => [agent.id, agent]))

  if (!connected) {
    return <div className="empty-state">先在设置中配对桌面端。</div>
  }

  if (selectedConversationId) {
    return (
      <div className="screen-stack">
        {detail ? (
          <>
            <section className="message-list">
              {detail.messages.length > 0 ? (
                detail.messages.map((message) => (
                  <MessageCard
                    key={message.id}
                    agent={message.agentId ? agentById.get(message.agentId) : undefined}
                    message={message}
                  />
                ))
              ) : (
                <div className="empty-state">这个会话还没有消息。</div>
              )}
            </section>

            <form
              className="composer"
              onSubmit={(event) => {
                event.preventDefault()
                const content = draft.trim()
                if (!content) return
                onSendMessage(content)
                setDraft('')
              }}
            >
              <textarea
                value={draft}
                rows={1}
                placeholder="输入意见或追问..."
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" className="primary-action icon-action" aria-label="发送" disabled={!draft.trim()}>
                <Send className="button-icon" aria-hidden="true" />
              </button>
            </form>
          </>
        ) : (
          <div className="empty-state">{loading ? '加载会话中...' : '会话详情暂不可用。'}</div>
        )}
      </div>
    )
  }

  return (
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
        <div className="empty-state">暂无会话。刷新 snapshot 后会显示桌面端会话列表。</div>
      )}
    </section>
  )
}

function MessageCard({ message, agent }: { message: MobileMessage; agent?: MobileAgent }) {
  const isUser = message.role === 'user'
  const displayName = isUser ? '你' : agent?.name ?? message.agentId ?? roleLabel(message.role)
  const avatar = avatarInitials(displayName, message.role)
  const toneKey = isUser ? 'mobile-user' : agent?.id ?? message.agentId ?? message.role

  return (
    <article className={`message-row ${message.role}`}>
      {!isUser && <AvatarBadge className="message-avatar" label={avatar} toneKey={toneKey} />}
      <div className="message-column">
        <div className="message-meta">
          <span>{displayName}</span>
          <time>{formatTime(message.createdAt)}</time>
        </div>
        <div className="message-bubble">
          <div className="message-parts">
            {message.parts.map((part, index) => (
              <MessagePartView key={`${message.id}-${index}`} part={part} />
            ))}
          </div>
        </div>
      </div>
      {isUser && <AvatarBadge className="message-avatar user-avatar" label={avatar} toneKey={toneKey} />}
    </article>
  )
}

function MessagePartView({ part }: { part: MobileMessagePart }) {
  switch (part.type) {
    case 'text':
      return <MarkdownText content={part.content} />
    case 'thinking':
      return (
        <details className="thinking-block">
          <summary>
            <Brain className="inline-icon" aria-hidden="true" />
            <span>思考</span>
            <ChevronDown className="thinking-toggle-icon thinking-toggle-closed" aria-hidden="true" />
            <ChevronUp className="thinking-toggle-icon thinking-toggle-open" aria-hidden="true" />
          </summary>
          <MarkdownText content={part.content} muted />
        </details>
      )
    case 'code':
      return <CodeBlock code={part.content} language={part.language} />
    case 'tool_use':
      return (
        <span className="inline-chip">
          <Wrench className="inline-icon" aria-hidden="true" />
          调用工具：{part.toolName}
        </span>
      )
    case 'tool_result':
      return (
        <span className="inline-chip">
          <Bot className="inline-icon" aria-hidden="true" />
          {part.isError ? '工具执行失败' : '工具执行完成'}
        </span>
      )
    case 'artifact_ref':
      return (
        <span className="inline-chip">
          <FileText className="inline-icon" aria-hidden="true" />
          产物：{part.artifactId}
        </span>
      )
    case 'attachment':
      return (
        <span className="inline-chip">
          {part.kind === 'image' ? (
            <ImageIcon className="inline-icon" aria-hidden="true" />
          ) : (
            <Paperclip className="inline-icon" aria-hidden="true" />
          )}
          {part.kind === 'image' ? '图片' : '文件'}：{part.fileName}
        </span>
      )
  }
}

function MarkdownText({ content, muted = false }: { content: string; muted?: boolean }) {
  if (!content) return null

  return (
    <div className={muted ? 'mobile-markdown muted-text' : 'mobile-markdown'}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code: ({ className, children }) => {
            const language = className?.match(/language-([^\s]+)/)?.[1]
            if (language) {
              return <CodeBlock code={reactNodeToText(children).replace(/\n$/, '')} language={language} />
            }
            return <code className="inline-code">{children}</code>
          },
          pre: ({ children }) => {
            if (isCodeBlockChild(children)) return <>{children}</>
            const block = extractPreCode(children)
            if (block) return <CodeBlock code={block.code} language={block.language} />
            return <pre className="markdown-pre">{children}</pre>
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function isCodeBlockChild(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(isCodeBlockChild)
  return isValidElement(node) && node.type === CodeBlock
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  return (
    <figure className="code-block">
      <figcaption>
        <Code2 className="inline-icon" aria-hidden="true" />
        {language || 'code'}
      </figcaption>
      <pre>{code}</pre>
    </figure>
  )
}

function extractPreCode(node: ReactNode): { code: string; language: string } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const block = extractPreCode(child)
      if (block) return block
    }
    return null
  }

  if (!isValidElement(node) || node.type !== 'code') return null

  const props = node.props as { className?: string; children?: ReactNode }
  const raw = reactNodeToText(props.children).replace(/\n$/, '')
  const language = props.className?.match(/language-([^\s]+)/)?.[1] ?? ''
  return { code: raw, language }
}

function reactNodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(reactNodeToText).join('')
  return ''
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
  return avatarInitials(title, undefined, fallback)
}

function avatarInitials(name: string, role?: MobileMessage['role'], fallback = 'AG'): string {
  if (role === 'user') return 'ME'
  if (role === 'system') return 'SY'

  const normalized = name.trim()
  if (!normalized) return fallback

  const asciiWords = normalized.match(/[a-zA-Z0-9]+/g)
  if (asciiWords && asciiWords.length > 0) {
    const first = asciiWords[0]?.[0] ?? ''
    const second = asciiWords.length > 1 ? asciiWords[1]?.[0] : asciiWords[0]?.[1]
    return `${first}${second ?? ''}`.toUpperCase()
  }

  const cjkChars = Array.from(normalized).filter((char) => /\p{Letter}|\p{Number}/u.test(char))
  return cjkChars.slice(0, 2).join('').toUpperCase() || fallback
}

function roleLabel(role: MobileMessage['role']): string {
  switch (role) {
    case 'user':
      return '你'
    case 'agent':
      return 'Agent'
    case 'system':
      return '系统'
  }
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
