# `@deepseek-ai/dsh-tool-vision`

Model-facing `describe_image` tool: sends a local PNG/JPEG/WebP to an OpenAI-compatible vision endpoint (GLM-4V by default) and returns a text description, so a text-only reasoning model can inspect images on demand without replacing the conversation model.

## Config

| Field | Default | Meaning |
|---|---|---|
| `model` | `glm-4v` | Vision model id sent to the endpoint. |
| `credentialEnv` | `ZHIPU_API_KEY` | Credential reference (environment-variable name) resolved per request through `ctx.credentials`. |
| `endpoint` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | OpenAI-compatible `chat/completions` endpoint. |
| `timeoutMs` | `60000` | Request timeout. |

## Model Experience

### Request context and condition

#### What the model sees

The `describe_image` tool schema (see the generated tool catalog) and, as the tool result, the vision model's returned description text. The image bytes never reach the reasoning model.

#### Token effect

The tool result consumes context proportionally to the returned description length; the image itself is not tokenized against the reasoning model's request.

#### KV Cache effect

Independent of the reasoning model's request prefix: the image is sent only to the vision endpoint, never to the reasoning model, so no reasoning-request prefix is invalidated by an image read.

## Known Limitations and Deferred Work

- **Bypasses the `ctx.fs` policy seam** — the tool reads the image file directly with `node:fs` instead of `ctx.fs.readBytes`, so filesystem policy and sandboxing do not gate this read. Route the read through the `fs` capability before shipping it as a product tool.
