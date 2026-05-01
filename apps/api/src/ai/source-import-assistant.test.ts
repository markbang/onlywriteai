import { expect, test } from "vite-plus/test";
import { createOpenAICompatibleSourceImportAssistant } from "./source-import-assistant.ts";

test("refuses localhost URL fetch tool calls", async () => {
  const fetchedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    fetchedUrls.push(String(url));
    if (url === "https://llm.test/v1/chat/completions") {
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "fetch_url",
                    arguments: JSON.stringify({ url: "http://localhost:8787/ready" }),
                  },
                },
              ],
            },
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };
  const assistant = createOpenAICompatibleSourceImportAssistant(
    {
      LLM_API_KEY: "test-key",
      LLM_BASE_URL: "https://llm.test/v1",
      LLM_MODEL: "test-model",
    },
    fetcher,
  );

  await expect(
    assistant.importSources({
      message: "http://localhost:8787/ready",
      createSource() {
        return null;
      },
    }),
  ).rejects.toThrow("Localhost URLs are not allowed");
  expect(fetchedUrls).toEqual(["https://llm.test/v1/chat/completions"]);
});
