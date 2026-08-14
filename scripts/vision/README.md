# describe-image — 识图助手

调用智谱 GLM-4V（OpenAI 兼容接口）识别本地图片，返回文字描述。这是给 DeepSeek Harness agent 旁挂的识图能力：主推理模型仍是 DeepSeek，只在需要"看"图时调用本脚本。

## 用法

```sh
node scripts/vision/describe-image.mjs <图片路径> [提示词...]
node scripts/vision/describe-image.mjs shot.png "图里的报错信息是什么？"
```

- 支持 PNG / JPEG / WebP（按扩展名判断）。
- 模型默认 `glm-4v`，可用 `GLM_VISION_MODEL` 环境变量或 `--model=xxx` 覆盖（如 `glm-4v-flash`、`glm-4v-plus`）。
- 输出为纯文本描述，直接进入 agent 上下文。

## 密钥

脚本按以下顺序取 key（不要贴在聊天或提交进 git）：

1. 环境变量 `ZHIPU_API_KEY`；
2. `$DSH_HOME/.credentials.yaml` 里的 `ZHIPU_API_KEY` 条目（当前已配置）。

key 若曾在聊天中泄露，请到智谱开放平台吊销并重新生成。

## 升级为第一方插件工具（可选）

当前是独立脚本，通过 `bash` 调用。若要变成模型可直接调用的 `describe_image` 工具（`ctx.tools` 插件、出现在工具列表、带参数校验和 UI 卡片），需要新建一个 workspace 包 + 装进 profile 并重启 Web 服务。需要时再走这条路。
