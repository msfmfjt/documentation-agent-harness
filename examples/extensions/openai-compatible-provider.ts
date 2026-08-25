import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("custom-openai", {
    name: "Custom OpenAI-Compatible Provider",
    baseUrl: process.env.CUSTOM_OPENAI_BASE_URL ?? "http://localhost:8080/v1",
    apiKey: "$CUSTOM_OPENAI_API_KEY",
    api: "openai-completions",
    models: [
      {
        id: process.env.CUSTOM_OPENAI_MODEL ?? "custom-model",
        name: process.env.CUSTOM_OPENAI_MODEL_NAME ?? "Custom Model",
        reasoning: false,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 128000,
        maxTokens: 4096,
      },
    ],
  });
}
