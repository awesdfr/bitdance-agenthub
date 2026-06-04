import type { ArtifactContent, ArtifactType } from '@/shared/types'

/**
 * 把 LLM 或用户给的松散 content 规整成强类型 ArtifactContent;非法返回 null。
 *
 * write_artifact 工具(agent 路径)与 artifact-service.createArtifactVersion(用户面板路径)
 * 共用本函数,保证产物内容的校验/规整是单一来源。
 */
export function buildArtifactContent(type: ArtifactType, raw: unknown): ArtifactContent | null {
  if (type === 'web_app') {
    // 情况 1: 标准 { files, entry }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>

      if (obj.files && typeof obj.files === 'object' && !Array.isArray(obj.files)) {
        const files = obj.files as Record<string, unknown>
        const normalised: Record<string, string> = {}
        for (const [k, v] of Object.entries(files)) {
          if (typeof v === 'string') normalised[k] = v
        }
        if (Object.keys(normalised).length === 0) return null
        return {
          type: 'web_app',
          files: normalised,
          entry: typeof obj.entry === 'string' ? obj.entry : 'index.html',
        }
      }

      // 情况 2: 扁平 { html, css, js }
      if (
        typeof obj.html === 'string' ||
        typeof obj.css === 'string' ||
        typeof obj.js === 'string'
      ) {
        const files: Record<string, string> = {}
        if (typeof obj.html === 'string') files['index.html'] = obj.html
        if (typeof obj.css === 'string') files['style.css'] = obj.css
        if (typeof obj.js === 'string') files['script.js'] = obj.js
        return { type: 'web_app', files, entry: 'index.html' }
      }

      // 情况 3: { content: '<html>...</html>' } 或 { code: '...' }
      if (typeof obj.content === 'string') {
        return {
          type: 'web_app',
          files: { 'index.html': obj.content },
          entry: 'index.html',
        }
      }
      if (typeof obj.code === 'string') {
        return {
          type: 'web_app',
          files: { 'index.html': obj.code },
          entry: 'index.html',
        }
      }
    }

    // 情况 4: 直接传 HTML 字符串
    if (typeof raw === 'string') {
      return { type: 'web_app', files: { 'index.html': raw }, entry: 'index.html' }
    }

    return null
  }

  if (type === 'document') {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.content === 'string') {
        return { type: 'document', format: 'markdown', content: obj.content }
      }
      if (typeof obj.markdown === 'string') {
        return { type: 'document', format: 'markdown', content: obj.markdown }
      }
      if (typeof obj.text === 'string') {
        return { type: 'document', format: 'markdown', content: obj.text }
      }
    }
    if (typeof raw === 'string') {
      return { type: 'document', format: 'markdown', content: raw }
    }
    return null
  }

  if (type === 'image') {
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj.url === 'string') {
        return {
          type: 'image',
          url: obj.url,
          alt: typeof obj.alt === 'string' ? obj.alt : '',
        }
      }
    }
    if (typeof raw === 'string') {
      return { type: 'image', url: raw, alt: '' }
    }
    return null
  }

  return null
}
