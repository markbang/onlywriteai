import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { DocumentSourceRecord } from "../db/schema.ts";
import type { DocumentSourceInput } from "../documents/repository.ts";
import { WritingAssistantConfigurationError } from "./writing-assistant.ts";

export type SourceImportInput = {
  message: string;
  createSource(input: DocumentSourceInput): DocumentSourceRecord | null;
};

export type SourceImportResult = {
  sources: DocumentSourceRecord[];
  model: string;
  fetchedUrls: number;
};

export type SourceImportAssistant = {
  importSources(input: SourceImportInput): Promise<SourceImportResult>;
};

type ChatCompletionMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: ChatCompletionMessage;
  }>;
};

const defaultFetchTimeoutMs = 15_000;
const defaultLlmTimeoutMs = 120_000;
const maxFetchedBytes = 1_000_000;

export type FetchedUrlResult = {
  content: string;
  contentType: string;
  status: number;
  url: string;
};

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, timer };
}

function configuredTimeout(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n[truncated]` : value;
}

function cleanFetchedText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArguments(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeTags(value: unknown) {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === "string") : [];
}

function toSourceInput(argumentsRecord: Record<string, unknown>): DocumentSourceInput {
  return {
    type: typeof argumentsRecord.type === "string" ? argumentsRecord.type : "text",
    title: typeof argumentsRecord.title === "string" ? argumentsRecord.title : undefined,
    note: typeof argumentsRecord.note === "string" ? argumentsRecord.note : undefined,
    url: typeof argumentsRecord.url === "string" ? argumentsRecord.url : undefined,
    fileName: typeof argumentsRecord.fileName === "string" ? argumentsRecord.fileName : undefined,
    tags: normalizeTags(argumentsRecord.tags),
  };
}

function assertImportUrl(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("URL is required");
  }

  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP(S) URLs can be fetched");
  }

  return url.toString();
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first === 0
  );
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized === "::" ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

async function assertPublicHttpUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.username || url.password) {
    throw new Error("URL credentials are not allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Localhost URLs are not allowed");
  }

  const ipVersion = isIP(hostname);
  const addresses =
    ipVersion === 0
      ? await lookup(hostname, { all: true, verbatim: true })
      : [{ address: hostname, family: ipVersion }];
  if (
    addresses.some((address) =>
      address.family === 4 ? isPrivateIpv4(address.address) : isPrivateIpv6(address.address),
    )
  ) {
    throw new Error("Private network URLs are not allowed");
  }

  return url.toString();
}

async function limitedText(response: Response, maxBytes: number) {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error("Fetched URL response is too large");
  }
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }

    total += chunk.value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => undefined);
      throw new Error("Fetched URL response is too large");
    }
    chunks.push(chunk.value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchPublicUrl({
  fetcher = fetch,
  maxBytes = maxFetchedBytes,
  timeoutMs = defaultFetchTimeoutMs,
  url,
}: {
  fetcher?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
  url: string;
}): Promise<FetchedUrlResult> {
  const safeUrl = await assertPublicHttpUrl(assertImportUrl(url));
  const timeout = timeoutSignal(timeoutMs);
  try {
    const response = await fetcher(safeUrl, {
      headers: { "user-agent": "OnlyWrite source importer" },
      signal: timeout.signal,
    });
    const text = await limitedText(response, maxBytes);
    return {
      content: truncate(cleanFetchedText(text), 12_000),
      contentType: response.headers.get("content-type") ?? "",
      status: response.status,
      url: safeUrl,
    };
  } finally {
    clearTimeout(timeout.timer);
  }
}

export function createOpenAICompatibleSourceImportAssistant(
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
): SourceImportAssistant {
  const apiKey = env.LLM_API_KEY ?? env.OPENAI_API_KEY;
  const baseUrl = (env.LLM_BASE_URL ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
    /\/$/,
    "",
  );
  const model = env.LLM_MODEL ?? env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const fetchTimeoutMs = configuredTimeout(env.SOURCE_FETCH_TIMEOUT_MS, defaultFetchTimeoutMs);
  const llmTimeoutMs = configuredTimeout(
    env.LLM_TIMEOUT_MS ?? env.OPENAI_TIMEOUT_MS,
    defaultLlmTimeoutMs,
  );

  async function complete(messages: ChatCompletionMessage[]) {
    const timeout = timeoutSignal(llmTimeoutMs);
    let response: Response;
    try {
      response = await fetcher(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        signal: timeout.signal,
        body: JSON.stringify({
          model,
          temperature: 0.1,
          messages,
          tools: [
            {
              type: "function",
              function: {
                name: "fetch_url",
                description:
                  "Fetch a URL supplied by the user so you can inspect page, RSS, or plain text content before creating a source.",
                parameters: {
                  type: "object",
                  properties: {
                    url: { type: "string" },
                  },
                  required: ["url"],
                },
              },
            },
            {
              type: "function",
              function: {
                name: "create_source",
                description:
                  "Create one source in OnlyWrite. Use rss for RSS feeds, text for pasted text or regular pages, pdf for PDFs, and image for images.",
                parameters: {
                  type: "object",
                  properties: {
                    type: { type: "string", enum: ["text", "rss", "pdf", "image"] },
                    title: { type: "string" },
                    note: { type: "string" },
                    url: { type: "string" },
                    fileName: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                  },
                  required: ["type"],
                },
              },
            },
          ],
          tool_choice: "auto",
        }),
      });
    } catch (error) {
      if ((error as { name?: string }).name === "AbortError") {
        throw new Error("LLM request timed out");
      }

      throw error;
    } finally {
      clearTimeout(timeout.timer);
    }

    if (!response.ok) {
      throw new Error(`LLM request failed with status ${response.status}`);
    }

    const body = (await response.json()) as ChatCompletionResponse;
    return body.choices?.[0]?.message ?? null;
  }

  return {
    async importSources(input) {
      if (!apiKey) {
        throw new WritingAssistantConfigurationError();
      }

      const createdSources: DocumentSourceRecord[] = [];
      let fetchedUrls = 0;
      const messages: ChatCompletionMessage[] = [
        {
          role: "system",
          content:
            "You import reference sources into OnlyWrite. For every URL in the user message, call fetch_url first, then create_source with a concise title, a useful description in note, the URL, and 2-5 tags. For pasted standalone text, create a text source. Create separate sources for separate URLs and separate pasted text blocks. Do not ask follow-up questions.",
        },
        {
          role: "user",
          content: input.message,
        },
      ];

      for (let round = 0; round < 8; round += 1) {
        const message = await complete(messages);
        if (!message) {
          break;
        }

        messages.push(message);
        const toolCalls = message.tool_calls ?? [];
        if (toolCalls.length === 0) {
          break;
        }

        for (const toolCall of toolCalls) {
          const argumentsRecord = parseArguments(toolCall.function.arguments);
          let content: unknown;

          if (toolCall.function.name === "fetch_url") {
            content = await fetchPublicUrl({
              fetcher,
              timeoutMs: fetchTimeoutMs,
              url: assertImportUrl(argumentsRecord.url),
            });
            fetchedUrls += 1;
          } else if (toolCall.function.name === "create_source") {
            const source = input.createSource(toSourceInput(argumentsRecord));
            if (!source) {
              content = {
                ok: false,
                error: "Source requires a valid type and a URL, file, or note.",
              };
            } else {
              createdSources.push(source);
              content = { ok: true, sourceId: source.id };
            }
          } else {
            content = { ok: false, error: "Unknown tool" };
          }

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(content),
          });
        }
      }

      return { sources: createdSources, model, fetchedUrls };
    },
  };
}
