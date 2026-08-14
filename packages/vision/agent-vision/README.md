# `@deepseek-ai/dsh-agent-vision`

Transparent image transcription for text-only models. At `agent/pre-step` it converts image content blocks in a claimed user message into text via a vision endpoint (GLM-4V by default), so a pasted image reaches the reasoning model as a description without switching the conversation model.

## Config

| Field | Default | Meaning |
|---|---|---|
| `model` | `glm-4v` | Vision model id sent to the endpoint. |
| `credentialEnv` | `ZHIPU_API_KEY` | Credential reference resolved per request through `ctx.credentials`. |
| `endpoint` | `https://open.bigmodel.cn/api/paas/v4/chat/completions` | OpenAI-compatible `chat/completions` endpoint. |
| `timeoutMs` | `60000` | Request timeout. |

## Model Experience

### Request context and condition

#### What the model sees

When a claimed user message contains an image block, the image is replaced by a text block carrying the vision model's description, prefixed with a fixed label. The image itself never reaches the reasoning model.

#### Token effect

The vision description consumes context proportionally to its length; the image bytes are not tokenized against the reasoning model's request.

#### KV Cache effect

Independent of the reasoning model's request prefix: the image is sent only to the vision endpoint, never to the reasoning model.

## Known Limitations and Deferred Work

- **Image is not re-displayed in the message** — the transcription replaces the image block in the entered message, so the sent message renders as text rather than an image thumbnail; the original bytes remain in the attachment store but are unreferenced.
- **Requires a host-gate relaxation** — the `apiproxy` image-admission gate must admit images for text-only models, or the message is rejected before it reaches `agent/pre-step`.
