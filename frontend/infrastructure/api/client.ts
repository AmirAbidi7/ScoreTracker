import { API_BASE_URL } from "./config";
import type { Scoreboard } from "../../src/features/scoreTracking/domain/Scoreboard";

export type ApiClientFailure = "transport" | "unencodable-value";

export class ApiClientError extends Error {
  readonly status: number;

  readonly failure: ApiClientFailure;

  constructor(message: string, status: number, failure: ApiClientFailure = "transport") {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.failure = failure;
  }

  get isOffline(): boolean {
    return this.status === 0;
  }
}

export type ApiClientOptions = {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? API_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      });
    } catch (cause) {
      throw new ApiClientError(
        cause instanceof Error && cause.message ? cause.message : "Can't reach the server",
        0,
      );
    }

    if (!response.ok) {
      throw new ApiClientError(await readErrorMessage(response), response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiClientError(
        `Malformed response from server (status ${response.status})`,
        response.status,
      );
    }
  }

  createScoreboard(gameName: string): Promise<Scoreboard> {
    return this.request<Scoreboard>("/api/scoreboard", {
      method: "POST",
      body: JSON.stringify({ scoreboard: { gameName } }),
    });
  }

  joinScoreboard(code: string): Promise<Scoreboard> {
    return this.request<Scoreboard>(`/api/scoreboard/join/${encodePathSegment(code)}`);
  }

  getScoreboard(id: string): Promise<Scoreboard> {
    return this.request<Scoreboard>(`/api/scoreboard/${encodePathSegment(id)}`);
  }

  listScoreboards(): Promise<Scoreboard[]> {
    return this.request<Scoreboard[]>("/api/scoreboard");
  }

  deleteScoreboard(id: string): Promise<void> {
    return this.request<void>(`/api/scoreboard/${encodePathSegment(id)}`, { method: "DELETE" });
  }
}

const encodePathSegment = (value: string): string => {
  try {
    return encodeURIComponent(value);
  } catch {
    throw new ApiClientError(
      `Cannot build a request URL from ${JSON.stringify(value)}`,
      0,
      "unencodable-value",
    );
  }
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
  } catch {
  }
  return `Request failed with status ${response.status}`;
};

export const apiClient = new ApiClient();
