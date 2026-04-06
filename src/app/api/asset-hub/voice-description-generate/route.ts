import { NextRequest, NextResponse } from 'next/server'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import type { Locale } from '@/i18n/routing'

interface VoiceDescriptionGenerateRequest {
  speaker?: string
  role?: string
  age?: string
  appearance?: string
  personality?: string
  locale?: Locale
}

/**
 * POST /api/asset-hub/voice-description-generate
 * 根据角色设定，调用 LLM 生成声音特征描述（任务化）
 */
export const POST = apiHandler(async (request: NextRequest) => {
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as VoiceDescriptionGenerateRequest
  const { speaker, role, age, appearance, personality, locale } = body

  if (!speaker && !role && !age && !appearance && !personality) {
    throw new ApiError('INVALID_PARAMS')
  }

  const resolvedLocale = resolveRequiredTaskLocale(request, body)

  const payload = {
    speaker: speaker || '未知',
    role: role || '普通角色',
    age: age || '未知',
    appearance: appearance || '未知',
    personality: personality || '未知',
    locale: locale || resolvedLocale || 'zh',
    displayMode: 'detail' as const,
  }

  const result = await submitTask({
    userId: session.user.id,
    locale: resolvedLocale,
    requestId: getRequestId(request),
    projectId: 'global-asset-hub',
    type: TASK_TYPE.VOICE_DESCRIPTION_GENERATE,
    targetType: 'GlobalAssetHubVoiceDescription',
    targetId: session.user.id,
    payload,
    dedupeKey: `${TASK_TYPE.VOICE_DESCRIPTION_GENERATE}:${session.user.id}:${speaker || ''}:${role || ''}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESCRIPTION_GENERATE, payload),
  })

  return NextResponse.json(result)
})
