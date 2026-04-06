'use client'

import { useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'

interface StepParseProps {
  projectId: string
  /** 任务 ID（可选），用于确认任务完成 */
  taskId?: string
  /** 父级已切换到 preview 阶段，但仍需保持流式输出显示 */
  orphaned?: boolean
  /** 流结束时回调（通知父级清除 orphanedStream） */
  onStreamEnd?: () => void
}

/** 从 SSE 事件中提取 stream.delta 字符串 */
function extractDelta(event: Record<string, unknown>): string | null {
  const payload = event.payload as Record<string, unknown> | null
  if (!payload) return null
  const chunk = payload.stream as Record<string, unknown> | null
  if (!chunk) return null
  return typeof chunk.delta === 'string' ? chunk.delta : null
}

export default function StepParse({ projectId, taskId, orphaned, onStreamEnd }: StepParseProps) {
  const t = useTranslations('smartImport')
  const [displayLines, setDisplayLines] = useState<string[]>([])
  const esRef = useRef<EventSource | null>(null)
  const linesRef = useRef<string[]>([])
  const connectedRef = useRef(false)

  useEffect(() => {
    if (connectedRef.current) return
    connectedRef.current = true

    const url = `/api/sse?projectId=${encodeURIComponent(projectId)}`
    const es = new EventSource(url)
    esRef.current = es

    const handleMessage = (e: MessageEvent) => {
      try {
        const raw = e.data || '{}'
        const event = JSON.parse(raw) as Record<string, unknown>

        // task.lifecycle completion → 任务完成，不再需要这个连接
        if (event.type === 'task.lifecycle') {
          const payload = event.payload as Record<string, unknown> | null
          const lifecycleType = payload?.lifecycleType as string | undefined
          if (lifecycleType === 'task.completed' || lifecycleType === 'completed') {
            esRef.current?.close()
            onStreamEnd?.()
          }
          return
        }

        // 只处理 task.stream
        if (event.type !== 'task.stream') return
        const delta = extractDelta(event)
        if (!delta) return

        // 追加新行（保留最近2行）
        linesRef.current = [...linesRef.current, delta].slice(-2)
        setDisplayLines([...linesRef.current])
      } catch {}
    }

    es.addEventListener('message', handleMessage)
    es.addEventListener('task.stream', handleMessage as EventListener)
    es.addEventListener('task.lifecycle', handleMessage as EventListener)
    es.onerror = () => {
      // SSE 断开时也通知父级
      onStreamEnd?.()
    }

    return () => {
      es.removeEventListener('message', handleMessage)
      es.removeEventListener('task.stream', handleMessage as EventListener)
      es.removeEventListener('task.lifecycle', handleMessage as EventListener)
      es.close()
      esRef.current = null
      connectedRef.current = false
    }
  }, [projectId, onStreamEnd])

  return (
    <div className="min-h-[calc(100vh-200px)] flex items-center justify-center p-8">
      <div className="text-center">
        <div className="flex gap-1.5 justify-center mb-8">
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="w-3 h-12 bg-[var(--glass-accent-from)] rounded-full"
              style={{
                animation: 'wave 1s ease-in-out infinite',
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </div>
        <h2 className="text-xl font-semibold text-[var(--glass-text-primary)] mb-2">{t('analyzing.title')}</h2>
        <p className="text-[var(--glass-text-secondary)]">{t('analyzing.description')}</p>
        <p className="text-sm text-[var(--glass-text-tertiary)] mt-2">{t('analyzing.autoSave')}</p>

        {/* LLM streaming output — 最新2行 */}
        <div className="mt-4 max-w-md mx-auto text-left">
          <div className="font-mono text-xs text-[var(--glass-text-secondary)] bg-[var(--glass-surface)] rounded-lg px-3 py-2 min-h-[3rem] whitespace-pre-wrap break-all leading-relaxed">
            {displayLines.length > 0
              ? displayLines.join('\n')
              : <span className="text-[var(--glass-text-tertiary)]">等待 AI 输出...</span>}
            <span className="animate-pulse">▋</span>
          </div>
        </div>

        <style jsx>{`
          @keyframes wave {
            0%, 100% { transform: scaleY(0.4); }
            50% { transform: scaleY(1); }
          }
        `}</style>
      </div>
    </div>
  )
}
