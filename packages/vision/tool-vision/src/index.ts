/**
 * Model-facing `describe_image` tool: sends a local PNG/JPEG/WebP to an
 * OpenAI-compatible vision endpoint (GLM-4V by default) and returns a text
 * description, so a text-only reasoning model can inspect images on demand
 * without replacing the conversation model.
 *
 * The image bytes travel only to the vision endpoint — never into the
 * reasoning model's context — and the API key resolves per request through the
 * credential seam (`ctx.credentials`), never through configuration.
 * @module @deepseek-ai/dsh-tool-vision
 */

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Extensions `describe_image` accepts, mapped to their declared media type. */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

/** Default vision endpoint (Zhipu / bigmodel.cn OpenAI-compatible chat completions). */
const DEFAULT_ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-vision'

/** Services required before this plugin can register its tool. */
export const inject = ['tools']

/** Plugin configuration for the vision tool. */
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

/** Complete config after schemastery fills every default, with the credential reference validated. */
interface ResolvedConfig {
  model: string
  credentialEnv: CredentialRef
  endpoint: string
  timeoutMs: number
}

/**
 * Register the `describe_image` tool. The tool reads the named image, resolves
 * its API key through the credential seam, and POSTs the image as a base64 data
 * URL to the configured vision endpoint, returning the model's text.
 * @param ctx - the registration scope; execution resolves the optional
 *   `credentials` service and honors the caller-owned abort signal.
 * @param config - validated plugin configuration with defaults applied.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved: ResolvedConfig = {
    model: config.model ?? 'glm-4v',
    endpoint: config.endpoint ?? DEFAULT_ENDPOINT,
    timeoutMs: config.timeoutMs ?? 60_000,
    // Fails loud at load: a malformed reference would otherwise surface per call.
    credentialEnv: credentialRef(config.credentialEnv ?? 'ZHIPU_API_KEY'),
  }
  if (!Number.isInteger(resolved.timeoutMs) || resolved.timeoutMs < 1) {
    throw new Error('tool-vision: timeoutMs must be a positive integer')
  }
  if (resolved.model.length === 0) throw new Error('tool-vision: model must not be empty')
  if (resolved.endpoint.length === 0) throw new Error('tool-vision: endpoint must not be empty')

  ctx.tools.register(defineTool({
    name: 'describe_image',
    description: 'Describe a local image by sending it to a vision model (GLM-4V). Returns a text description so you can inspect an image without a multimodal conversation model. Provide a path to a PNG/JPEG/WebP file.',
    parameters: {
      file_path: { type: 'string', required: true, description: 'Path to the image file.' },
      prompt: { type: 'string', description: 'What to ask about the image. Defaults to a full objective description.' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const filePath = args.file_path.trim()
      if (filePath.length === 0) throw new Error('file_path must be a non-empty string')
      const mediaType = MEDIA_TYPES[extname(filePath).toLowerCase()]
      if (mediaType === undefined) {
        throw new Error(`describe_image only accepts PNG/JPEG/WebP paths: ${basename(filePath)}`)
      }

      const credentials = ctx.get('credentials')
      let apiKey: string | undefined
      if (credentials !== undefined) {
        apiKey = (await credentials.resolve(resolved.credentialEnv))?.value
      }
      apiKey ??= process.env[resolved.credentialEnv]
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error(`describe_image: no credential resolved for ${String(resolved.credentialEnv)}; configure it in the credential store or environment`)
      }

      const prompt = args.prompt ?? '请详细、客观地描述这张图片的内容，包括画面主体、文字、颜色和可能的用途。'
      const data = await readFile(filePath, { signal: exec.signal })
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(resolved.timeoutMs)])
      const response = await fetch(resolved.endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: resolved.model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data.toString('base64')}` } },
            ],
          }],
        }),
      })
      const body = await response.text()
      if (!response.ok) {
        throw new Error(`vision API ${response.status}: ${body.slice(0, 500)}`)
      }
      const parsed = JSON.parse(body) as { choices?: Array<{ message?: { content?: string } }> }
      const content = parsed.choices?.[0]?.message?.content
      if (content === undefined) {
        throw new Error(`unexpected vision API response: ${body.slice(0, 500)}`)
      }
      return content
    },
  }))
}
