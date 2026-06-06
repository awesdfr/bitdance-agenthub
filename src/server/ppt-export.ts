import { detectBulletTone, resolvePptTheme } from '@/shared/ppt-theme'
import type { ArtifactContent } from '@/shared/types'

type PptContent = Extract<ArtifactContent, { type: 'ppt' }>

/**
 * 把 ppt artifact 的结构化 slides JSON 转成真正的 .pptx 二进制（Office 可打开）。
 *
 * 视觉按 resolvePptTheme 的完整 token 渲染（背景 / 主色 / 正文色 / 字体 / 字号层级），
 * 而非单一主色。封面 / 章节页用主色背景 + 白字；内容页用冷白背景 + 顶部色条 + 主色标题
 * + 分割线 + 正文要点。与预览 SlideView 同源（都读 resolvePptTheme）。
 *
 * pptxgenjs 动态 import：仅导出时加载，且配合 next.config serverExternalPackages
 * 避免 standalone bundle 踩 CJS / 动态 require 坑。
 */
export async function slidesToPptxBuffer(
  content: PptContent,
  fallbackTitle: string,
): Promise<Uint8Array> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.title = content.title || fallbackTitle
  pptx.layout = 'LAYOUT_16x9'

  const t = resolvePptTheme(content.theme)

  for (const s of content.slides) {
    const slide = pptx.addSlide()
    const layout = s.layout ?? 'title-bullets'

    if (layout === 'title' || layout === 'section') {
      // 封面 / 章节：主色背景 + 白色大标题
      slide.background = { color: t.primary }
      if (s.title) {
        slide.addText(s.title, {
          x: 0.5,
          y: layout === 'title' ? 2.1 : 2.4,
          w: 9,
          h: 1.6,
          fontSize: layout === 'title' ? 40 : 32,
          bold: true,
          color: 'FFFFFF',
          fontFace: t.fontHeading,
          align: 'center',
        })
      }
      if (layout === 'title' && s.bullets && s.bullets.length > 0) {
        slide.addText(s.bullets.join('\n'), {
          x: 0.5,
          y: 4.0,
          w: 9,
          h: 1.4,
          fontSize: 16,
          color: 'E8EDF3',
          fontFace: t.fontBody,
          align: 'center',
          lineSpacingMultiple: 1.3,
        })
      }
    } else {
      // 内容页：冷白背景 + 顶部主色条 + 主色标题 + 分割线 + 正文
      slide.background = { color: t.background }
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: '100%',
        h: 0.16,
        fill: { color: t.primary },
        line: { color: t.primary, width: 0 },
      })
      if (s.title) {
        slide.addText(s.title, {
          x: 0.5,
          y: 0.5,
          w: 9,
          h: 0.8,
          fontSize: 28,
          bold: true,
          color: t.primary,
          fontFace: t.fontHeading,
        })
        slide.addShape(pptx.ShapeType.line, {
          x: 0.5,
          y: 1.4,
          w: 9,
          h: 0,
          line: { color: t.divider, width: 1 },
        })
      }
      if (s.bullets && s.bullets.length > 0) {
        // 每个要点一张卡片行（surface 底 + 细边框），tone 图标着色：▲正面墨绿 / ▼警示深红 / •中性
        const n = s.bullets.length
        const top = 1.7
        const avail = 3.9
        const gap = 0.12
        const cardH = Math.min(0.72, (avail - gap * (n - 1)) / n)
        s.bullets.forEach((text, i) => {
          const tone = detectBulletTone(text)
          const toneColor =
            tone === 'positive'
              ? t.accentPositive
              : tone === 'negative'
                ? t.accentNegative
                : t.primary
          const icon = tone === 'positive' ? '▲  ' : tone === 'negative' ? '▼  ' : '•  '
          slide.addText(
            [
              { text: icon, options: { color: toneColor, bold: true } },
              { text, options: { color: t.textBody } },
            ],
            {
              x: 0.7,
              y: top + i * (cardH + gap),
              w: 8.6,
              h: cardH,
              fontSize: 14,
              fontFace: t.fontBody,
              valign: 'middle',
              fill: { color: t.surface },
              line: { color: t.divider, width: 0.5 },
            },
          )
        })
      }
    }

    if (s.notes) slide.addNotes(s.notes)
  }

  // outputType 'nodebuffer' 返回 Node Buffer（Uint8Array 子类）
  return (await pptx.write({ outputType: 'nodebuffer' })) as Uint8Array
}
