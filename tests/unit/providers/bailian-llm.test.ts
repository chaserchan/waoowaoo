import { beforeEach, describe, expect, it, vi } from 'vitest'

const createChatCompletionMock = vi.hoisted(() =>
  vi.fn(async ({ stream }: { stream?: boolean }) => {
    if (stream === true) {
      return (async function* () {
        yield {
          id: 'chatcmpl_bailian',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'qwen3.5-plus',
          choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: null }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }
        yield {
          id: 'chatcmpl_bailian',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'qwen3.5-plus',
          choices: [{ index: 0, delta: { content: ' world' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 6 },
        }
      })()
    }
    return {
      id: 'chatcmpl_bailian',
      object: 'chat.completion',
      created: 1,
      model: 'qwen3.5-plus',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    }
  }),
)

const openAiCtorMock = vi.hoisted(() =>
  vi.fn(() => ({
    chat: {
      completions: {
        create: createChatCompletionMock,
      },
    },
  })),
)

vi.mock('openai', () => ({
  default: openAiCtorMock,
}))

import { completeBailianLlm, completeBailianLlmStream, extractBailianUsage } from '@/lib/providers/bailian/llm'

describe('bailian llm provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls dashscope openai-compatible endpoint for registered qwen model', async () => {
    const completion = await completeBailianLlm({
      modelId: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      apiKey: 'bl-key',
      temperature: 0.2,
    })

    expect(openAiCtorMock).toHaveBeenCalledWith({
      apiKey: 'bl-key',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      timeout: 30_000,
    })
    expect(createChatCompletionMock).toHaveBeenCalledWith({
      model: 'qwen3.5-plus',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
      stream: false,
    })
    expect(completion.choices[0]?.message?.content).toBe('ok')
  })

  it('fails fast when model is not in official bailian catalog', async () => {
    await expect(
      completeBailianLlm({
        modelId: 'qwen-plus',
        messages: [{ role: 'user', content: 'hello' }],
        apiKey: 'bl-key',
      }),
    ).rejects.toThrow(/MODEL_NOT_REGISTERED/)

    expect(openAiCtorMock).not.toHaveBeenCalled()
    expect(createChatCompletionMock).not.toHaveBeenCalled()
  })

  describe('completeBailianLlmStream', () => {
    it('yields chunks from bailian stream endpoint', async () => {
      const chunks: unknown[] = []
      for await (const chunk of await completeBailianLlmStream({
        modelId: 'qwen3.5-plus',
        messages: [{ role: 'user', content: 'hello' }],
        apiKey: 'bl-key',
        temperature: 0.2,
      })) {
        chunks.push(chunk)
      }
      expect(chunks).toHaveLength(2)
      expect((chunks[0] as { choices: unknown[] }).choices[0]).toMatchObject({
        delta: { content: 'hello' },
        finish_reason: null,
      })
    })
  })

  describe('extractBailianUsage', () => {
    it('extracts usage from last chunk', () => {
      const lastChunk = {
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      } as never
      expect(extractBailianUsage(lastChunk)).toEqual({
        promptTokens: 10,
        completionTokens: 5,
      })
    })

    it('returns zeros when chunk is null', () => {
      expect(extractBailianUsage(null)).toEqual({
        promptTokens: 0,
        completionTokens: 0,
      })
    })

    it('returns zeros when usage is missing', () => {
      const chunk = { usage: undefined } as never
      expect(extractBailianUsage(chunk)).toEqual({
        promptTokens: 0,
        completionTokens: 0,
      })
    })
  })
})
