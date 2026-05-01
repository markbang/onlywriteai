import { expect, test } from "vite-plus/test";
import { createOpenAICompatibleWritingAssistant } from "./writing-assistant.ts";

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    text += decoder.decode(chunk.value, { stream: true });
  }

  return text + decoder.decode();
}

test("streams parsed reasoning and text deltas", async () => {
  let body: unknown;
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(typeof init?.body).toBe("string");
    body = JSON.parse(init?.body as string);

    return new Response(
      [
        'data: {"choices":[{"delta":{"reasoning_content":"Think."}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Answer."}}]}\n\n',
        'data: {"choices":[],"usage":{"completion_tokens":4,"prompt_tokens":8,"total_tokens":12}}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    );
  };

  const assistant = createOpenAICompatibleWritingAssistant(
    {
      LLM_API_KEY: "test-key",
      LLM_BASE_URL: "https://llm.test/v1",
      LLM_MODEL: "test-model",
      LLM_STREAM_API: "chat",
    },
    fetcher,
  );

  const result = await assistant.stream({
    document: {
      id: "doc-1",
      userId: "user-1",
      title: "Draft",
      content: "Body",
      createdAt: 1,
      updatedAt: 1,
    },
    instruction: "Continue",
    reasoningEffort: "medium",
    thinkingEnabled: true,
    sources: [],
  });

  const events = (await readStream(result.stream))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { delta: string; type: string });

  expect(result.format).toBe("events");
  expect(body).toMatchObject({
    enable_thinking: true,
    model: "test-model",
    reasoning_effort: "medium",
    stream: true,
    stream_options: { include_usage: true },
    thinking: { type: "enabled" },
  });
  expect(events).toEqual([
    { type: "reasoning", delta: "Think." },
    { type: "text", delta: "Answer." },
    { type: "usage", delta: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
  ]);
});

test("uses responses streaming for GPT-5 models", async () => {
  let body: unknown;
  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(typeof init?.body).toBe("string");
    body = JSON.parse(init?.body as string);

    return new Response(
      [
        'data: {"type":"response.reasoning_summary_text.delta","delta":"Think."}\n\n',
        'data: {"type":"response.output_text.delta","delta":"Answer."}\n\n',
        'data: {"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":4,"total_tokens":12}}}\n\n',
        "data: [DONE]\n\n",
      ].join(""),
    );
  };

  const assistant = createOpenAICompatibleWritingAssistant(
    {
      OPENAI_API_KEY: "test-key",
      OPENAI_MODEL: "gpt-5.5",
    },
    fetcher,
  );

  const result = await assistant.stream({
    document: {
      id: "doc-1",
      userId: "user-1",
      title: "Draft",
      content: "Body",
      createdAt: 1,
      updatedAt: 1,
    },
    instruction: "Continue",
    reasoningEffort: "medium",
    thinkingEnabled: true,
    sources: [],
  });

  const events = (await readStream(result.stream))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { delta: string; type: string });

  expect(body).toMatchObject({
    instructions: expect.any(String),
    model: "gpt-5.5",
    reasoning: { effort: "medium", summary: "auto" },
    stream: true,
  });
  expect(events).toEqual([
    { type: "reasoning", delta: "Think." },
    { type: "text", delta: "Answer." },
    { type: "usage", delta: { inputTokens: 8, outputTokens: 4, totalTokens: 12 } },
  ]);
});
