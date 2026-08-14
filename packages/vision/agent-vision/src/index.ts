/**
 * Transparent image transcription: converts image content blocks in claimed
 * user messages into text (via a GLM-4V-style vision endpoint) at
 * `agent/pre-step`, so a text-only reasoning model can receive pasted images
 * without replacing the conversation model.
 *
 * The image bytes travel only to the vision endpoint; the transcription
 * replaces the image block in the message that enters the step, so the
 * logged, model-visible content is text.
 * @module @deepseek-ai/dsh-agent-vision
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'

const DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'agent-vision'

/** The agent registry that owns pre-step processing. */
export const inject = ['agents']

/** Plugin configuration for the transcription step. */
export interface Config {
  /** Vision model id sent to the endpoint. Defaults to `glm-4v`. */
  model?: string
  /** Credential reference (environment-variable name) resolved per request through `ctx.credentials`. Defaults to `ZHIPU_API_KEY`. */
  credentialEnv?: string
  /** OpenAI-compatible `chat/completions` endpoint. Defaults to the Zhipu (bigmodel.cn) endpoint. */
  endpoint?: string
  /** Request timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  model: z.string().default('glm-4v'),
  credentialEnv: z.string().default('ZHIPU_API_KEY'),
  endpoint: z.string().default(DEFAULT_ENDPOINT),
  timeoutMs: z.number().default(60_000),
})

/** Complete config after schemastery fills defaults, with the credential reference validated. */
interface ResolvedConfig {
  model: string
  credentialEnv: CredentialRef
  endpoint: string
  timeoutMs: number
}

function hasImage(content: ContentBlock[]): boolean {
  return content.some(block => block.type === 'image')
}

async function resolveApiKey(ctx: Context, ref: CredentialRef): Promise<string> {
  const credentials = ctx.get('credentials')
  const value = (await credentials?.resolve(ref))?.value ?? process.env[ref]
  if (value === undefined || value.length === 0) {
    throw new Error(`agent-vision: no credential resolved for ${String(ref)}`)
  }
  return value
}

async function describeImage(
  ctx: Context,
  resolved: ResolvedConfig,
  data: Uint8Array,
  mediaType: string,
  signal: AbortSignal,
): Promise<string> {
  const apiKey = await resolveApiKey(ctx, resolved.credentialEnv)
  const response = await fetch(resolved.endpoint, {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(resolved.timeoutMs)]),
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: resolved.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '请详细、客观地描述这张图片的内容，包括画面主体、文字、颜色和可能的用途。' },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${Buffer.from(data).toString('base64')}` } },
        ],
      }],
    }),
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`agent-vision: vision API ${response.status}: ${body.slice(0, 500)}`)
  }
  const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }
  const content = parsed.choices?.[0]?.message?.content
  if (content === undefined) {
    throw new Error(`agent-vision: unexpected vision API response: ${body.slice(0, 500)}`)
  }
  return content
}

async function transcribeContent(
  ctx: Context,
  resolved: ResolvedConfig,
  content: ContentBlock[],
  signal: AbortSignal,
): Promise<ContentBlock[]> {
  const out: ContentBlock[] = []
  const attachments = ctx.get('attachments')
  for (const block of content) {
    if (block.type !== 'image') {
      out.push(block)
      continue
    }
    if (attachments === undefined) {
      out.push(block)
      continue
    }
    try {
      const stored = await attachments.readImage(block.attachment, signal)
      const description = await describeImage(ctx, resolved, stored.data, block.attachment.mediaType, signal)
      out.push({ type: 'text', text: `[用户提供了一张图片，已自动识别，内容如下]\n${description}` })
    } catch (error: unknown) {
      out.push({ type: 'text', text: `[用户提供了一张图片，但自动识别失败：${error instanceof Error ? error.message : String(error)}]` })
    }
  }
  return out
}

/**
 * Register the pre-step transcription hook. When a claimed batch carries an
 * image block, each image is transcribed to text and the message that enters
 * the step is replaced with the transcribed version.
 * @param ctx - the agent-scoped registration context.
 * @param config - validated plugin configuration with defaults applied.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    model: config.model ?? 'glm-4v',
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    timeoutMs: config.timeoutMs ?? 60_000,
    credentialEnv: credentialRef(config.credentialEnv ?? 'ZHIPU_API_KEY'),
  }
  if (!Number.isInteger(resolved.timeoutMs) || resolved.timeoutMs < 1) {
    throw new Error('agent-vision: timeoutMs must be a positive integer')
  }
  if (resolved.model.length === 0) throw new Error('agent-vision: model must not be empty')
  if (resolved.endpoint.length === 0) throw new Error('agent-vision: endpoint must not be empty')

  ctx.on('agent/pre-step', async ({ messages, signal }, next): Promise<PreStepDecision> => {
    if (!messages.some(message => hasImage(message.content))) return next()
    const transcribed = new Map<string, UserMessage>()
    for (const message of messages) {
      if (!hasImage(message.content)) continue
      transcribed.set(message.id, { ...message, content: await transcribeContent(ctx, resolved, message.content, signal) })
    }
    const decision = await next()
    if (decision.kind !== 'enter') return decision
    return {
      kind: 'enter',
      messages: decision.messages.map(entered => transcribed.get(entered.id) ?? entered),
    }
  })
}
