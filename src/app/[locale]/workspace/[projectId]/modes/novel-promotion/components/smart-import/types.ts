export interface SplitEpisode {
  number: number
  title: string
  summary: string
  content: string
  wordCount: number
}

export type WizardStage = 'select' | 'analyzing' | 'preview'

/** 保持流式输出显示的特殊阶段：wizard 已切换到 preview，但 SSE 流尚未结束 */
export type OrphanedStage = 'analyzing'

export interface DeleteConfirmState {
  show: boolean
  index: number
  title: string
}
