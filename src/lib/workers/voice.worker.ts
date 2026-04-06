import { Worker, type Job } from 'bullmq'
import { queueRedis } from '@/lib/redis'
import { generateVoiceLine } from '@/lib/voice/generate-voice-line'
import { QUEUE_NAME } from '@/lib/task/queues'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress, withTaskLifecycle } from './shared'
import { handleVoiceDesignTask } from './handlers/voice-design'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './handlers/llm-stream'
import { getUserModelConfig } from '@/lib/config-service'
import { assertTaskActive } from './utils'

type AnyObj = Record<string, unknown>

async function handleVoiceLineTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const lineId = typeof payload.lineId === 'string' ? payload.lineId : job.data.targetId
  const episodeId = typeof payload.episodeId === 'string' ? payload.episodeId : job.data.episodeId
  const audioModel = typeof payload.audioModel === 'string' && payload.audioModel.trim()
    ? payload.audioModel.trim()
    : undefined
  if (!lineId) {
    throw new Error('VOICE_LINE task missing lineId')
  }
  if (!episodeId) {
    throw new Error('VOICE_LINE task missing episodeId')
  }

  await reportTaskProgress(job, 20, { stage: 'generate_voice_submit', lineId })

  const generated = await generateVoiceLine({
    projectId: job.data.projectId,
    episodeId,
    lineId,
    userId: job.data.userId,
    audioModel,
  })

  await reportTaskProgress(job, 95, { stage: 'generate_voice_persist', lineId })

  return generated
}

async function handleVoiceDescriptionGenerateTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const speaker = typeof payload.speaker === 'string' ? payload.speaker : '未知'
  const role = typeof payload.role === 'string' ? payload.role : '普通角色'
  const age = typeof payload.age === 'string' ? payload.age : '未知'
  const appearance = typeof payload.appearance === 'string' ? payload.appearance : '未知'
  const personality = typeof payload.personality === 'string' ? payload.personality : '未知'
  const locale = (payload.locale as string) || 'zh'

  const userConfig = await getUserModelConfig(job.data.userId)
  const modelKey = userConfig.analysisModel
  if (!modelKey) {
    throw new Error('ANALYSIS_MODEL_NOT_CONFIGURED: 请先在设置页面配置分析模型')
  }

  const promptText = buildPrompt({
    promptId: PROMPT_IDS.VOICE_DESCRIPTION_GENERATE,
    locale: locale as 'zh' | 'en',
    variables: { speaker, role, age, appearance, personality },
  })

  await reportTaskProgress(job, 30, { stage: 'voice_description_generate' })
  const streamContext = createWorkerLLMStreamContext(job, 'voice_description')
  const callbacks = createWorkerLLMStreamCallbacks(job, streamContext)

  const completion = await withInternalLLMStreamCallbacks(callbacks, async () =>
    executeAiTextStep({
      userId: job.data.userId,
      model: modelKey,
      messages: [{ role: 'user', content: promptText }],
      reasoning: false,
      projectId: job.data.projectId,
      action: 'voice_description_generate',
      temperature: 0.3,
      meta: { stepId: 'voice_description_generate', stepTitle: '生成声音描述', stepIndex: 1, stepTotal: 1 },
    }),
  )
  await callbacks.flush()
  await assertTaskActive(job, 'voice_description_parse')

  const content = completion.text || ''
  const description = parseAndFormatVoiceDescription(content)

  await reportTaskProgress(job, 90, { stage: 'voice_description_complete' })
  return { description }
}

function parseAndFormatVoiceDescription(raw: string): string {
  const lines = raw.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  const result: string[] = []

  for (const line of lines) {
    const ageMatch = line.match(/^(年龄|Age)[:：]\s*(.+)/i)
    if (ageMatch) { result.push(`年龄：${ageMatch[2].trim()}`); continue }
    const genderMatch = line.match(/^(性别|Gender)[:：]\s*(.+)/i)
    if (genderMatch) { result.push(`性别：${genderMatch[2].trim()}`); continue }
    const timbreMatch = line.match(/^(音色|Timbre)[:：]\s*(.+)/i)
    if (timbreMatch) { result.push(`音色：${timbreMatch[2].trim()}`); continue }
    const toneMatch = line.match(/^(语调|Tone)[:：]\s*(.+)/i)
    if (toneMatch) { result.push(`语调：${toneMatch[2].trim()}`); continue }
  }
  return result.join('\n')
}

async function processVoiceTask(job: Job<TaskJobData>) {
  await reportTaskProgress(job, 5, { stage: 'received' })

  switch (job.data.type) {
    case TASK_TYPE.VOICE_LINE:
      return await handleVoiceLineTask(job)
    case TASK_TYPE.VOICE_DESIGN:
    case TASK_TYPE.ASSET_HUB_VOICE_DESIGN:
      return await handleVoiceDesignTask(job)
    case TASK_TYPE.VOICE_DESCRIPTION_GENERATE:
      return await handleVoiceDescriptionGenerateTask(job)
    default:
      throw new Error(`Unsupported voice task type: ${job.data.type}`)
  }
}

export function createVoiceWorker() {
  return new Worker<TaskJobData>(
    QUEUE_NAME.VOICE,
    async (job) => await withTaskLifecycle(job, processVoiceTask),
    {
      connection: queueRedis,
      concurrency: Number.parseInt(process.env.QUEUE_CONCURRENCY_VOICE || '10', 10) || 10,
    },
  )
}
