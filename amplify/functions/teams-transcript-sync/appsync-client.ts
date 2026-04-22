export interface GQLError {
  message: string;
  errorType?: string;
}

export interface GQLResult<T = unknown> {
  data: T | null;
  errors?: GQLError[];
}

export class AppSyncClient {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string
  ) {}

  async request<T>(
    document: string,
    variables?: Record<string, unknown>
  ): Promise<GQLResult<T>> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
      },
      body: JSON.stringify({ query: document, variables }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      throw new Error(`AppSync HTTP ${response.status}: ${body}`);
    }

    const result = (await response.json()) as {
      data?: T;
      errors?: GQLError[];
    };

    return { data: result.data ?? null, errors: result.errors };
  }
}
