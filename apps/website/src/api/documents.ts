export type Document = {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type DocumentInput = {
  title?: string;
  content?: string;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const defaultFetch: typeof fetch = (...args) => fetch(...args);

async function request<T>(
  path: string,
  init: RequestInit = {},
  fetcher = defaultFetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetcher(`/api${path}`, {
    ...init,
    headers,
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    const body = await response.json().catch(() => null);
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
    ) {
      message = (body as { error: { message: string } }).error.message;
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getHealth(fetcher?: typeof fetch) {
  return request<{ ok: true }>("/health", {}, fetcher);
}

export function listDocuments(fetcher?: typeof fetch) {
  return request<Document[]>("/documents", {}, fetcher);
}

export function getDocument(id: string, fetcher?: typeof fetch) {
  return request<Document>(`/documents/${id}`, {}, fetcher);
}

export function createDocument(input: DocumentInput, fetcher?: typeof fetch) {
  return request<Document>("/documents", { method: "POST", body: JSON.stringify(input) }, fetcher);
}

export function updateDocument(id: string, input: DocumentInput, fetcher?: typeof fetch) {
  return request<Document>(
    `/documents/${id}`,
    { method: "PATCH", body: JSON.stringify(input) },
    fetcher,
  );
}

export function deleteDocument(id: string, fetcher?: typeof fetch) {
  return request<void>(`/documents/${id}`, { method: "DELETE" }, fetcher);
}
