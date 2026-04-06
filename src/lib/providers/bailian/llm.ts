import OpenAI from 'openai'
import {
  assertOfficialModelRegistered,
  type OfficialModelModality,
} from '@/lib/providers/official/model-registry'
import { ensureBailianCatalogRegistered } from './catalog'
import type { BailianLlmMessage } from './types'

export function extractBailianUsage(
  lastChunk: OpenAI.Chat.Completions.ChatCompletionChunk | null,
): { promptTokens: number; completionTokens: number } {
  if (!lastChunk) return { promptTokens: 0, completionTokens: 0 }
  const usage = lastChunk.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
  }
}

export interface BailianLlmCompletionParams {
  modelId: string
  messages: BailianLlmMessage[]
  apiKey: string
  baseUrl?: string
  temperature?: number
}

function assertRegistered(modelId: string): void {
  ensureBailianCatalogRegistered()
  assertOfficialModelRegistered({
    provider: 'bailian',
    modality: 'llm' satisfies OfficialModelModality,
    modelId,
  })
}

export async function completeBailianLlm(
  _params: BailianLlmCompletionParams,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  assertRegistered(_params.modelId)
  const baseURL = typeof _params.baseUrl === 'string' && _params.baseUrl.trim()
    ? _params.baseUrl.trim()
    : 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const client = new OpenAI({
    apiKey: _params.apiKey,
    baseURL,
    timeout: 30_000,
  })
  const completion = await client.chat.completions.create({
    model: _params.modelId,
    messages: _params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: _params.temperature ?? 0.7,
    stream: false,
  })
  return completion as OpenAI.Chat.Completions.ChatCompletion
}

export async function* completeBailianLlmStream(
  _params: BailianLlmCompletionParams,
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  assertRegistered(_params.modelId)
  const baseURL = typeof _params.baseUrl === 'string' && _params.baseUrl.trim()
    ? _params.baseUrl.trim()
    : 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  const client = new OpenAI({
    apiKey: _params.apiKey,
    baseURL,
    timeout: 120_000,
  })
  const stream = await client.chat.completions.create({
    model: _params.modelId,
    messages: _params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: _params.temperature ?? 0.7,
    stream: true,
  })
  for await (const chunk of stream) {
    yield chunk as OpenAI.Chat.Completions.ChatCompletionChunk
  }
}
