#!/usr/bin/env node
/**
 * describe-image — call a GLM-4V-style vision model to describe a local image.
 *
 * Usage:
 *   node describe-image.mjs <image-path> [prompt...]
 *
 * Reads the API key from $ZHIPU_API_KEY, else $DSH_HOME/.credentials.yaml
 * (ZHIPU_API_KEY entry). The model defaults to `glm-4v` and can be overridden
 * with $GLM_VISION_MODEL. Supports PNG/JPEG/WebP by extension; image bytes are
 * sent as a base64 data URL to the Zhipu (bigmodel.cn) OpenAI-compatible
 * chat/completions endpoint.
 *
 * This is a standalone helper (no package dependencies), not a shipped dsh
 * plugin. Keep the key out of git and out of chat; rotate it if it ever leaks.
 */
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { extname, basename } from 'node:path'
import { homedir } from 'node:os'

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'
const DEFAULT_MODEL = process.env.GLM_VISION_MODEL ?? 'glm-4v'
const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

/** Resolve the Zhipu API key from the environment, then the harness credential store. */
function resolveKey() {
  if (process.env.ZHIPU_API_KEY) return process.env.ZHIPU_API_KEY
  const home = process.env.DSH_HOME || `${homedir()}/.dsh`
  try {
    const text = readFileSync(`${home}/.credentials.yaml`, 'utf8')
    const match = text.match(/^ZHIPU_API_KEY:\s*['"]?([^'"\s]+)/m)
    if (match) return match[1]
  } catch {
    // fall through to the error below
  }
  throw new Error('ZHIPU_API_KEY not found: export it, or add a ZHIPU_API_KEY entry to ~/.dsh/.credentials.yaml')
}

async function main() {
  const args = process.argv.slice(2)
  const flag = args.findIndex((a) => a.startsWith('--model='))
  const model = flag >= 0 ? args.splice(flag, 1)[0].slice('--model='.length) : DEFAULT_MODEL
  if (args.length === 0) {
    console.error('usage: node describe-image.mjs <image-path> [prompt...]')
    process.exit(2)
  }
  const imagePath = args.shift()
  const prompt = args.join(' ') || '请详细、客观地描述这张图片的内容，包括画面主体、文字、颜色和可能的用途。'

  const mediaType = MEDIA_TYPES[extname(imagePath).toLowerCase()]
  if (!mediaType) throw new Error(`unsupported image type: ${basename(imagePath)} (use PNG/JPEG/WebP)`)

  const data = await readFile(imagePath)
  const key = resolveKey()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  let response
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${data.toString('base64')}` } },
          ],
        }],
      }),
    })
  } finally {
    clearTimeout(timer)
  }

  const body = await response.text()
  if (!response.ok) {
    throw new Error(`vision API ${response.status}: ${body.slice(0, 500)}`)
  }
  const parsed = JSON.parse(body)
  const content = parsed?.choices?.[0]?.message?.content
  if (content == null) throw new Error(`unexpected vision API response: ${body.slice(0, 500)}`)
  process.stdout.write(`${content}\n`)
}

main().catch((error) => {
  console.error(`describe-image: ${error.message}`)
  process.exit(1)
})
