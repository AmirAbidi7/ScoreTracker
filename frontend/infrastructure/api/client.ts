import { API_BASE_URL } from "./config";
import type { Scoreboard } from "../../src/features/scoreTracking/domain/Scoreboard";

/**
 * Which of two unrelated situations a `status: 0` error is reporting.
 *
 * Both never reached the server, so `0` cannot separate them — and it must not
 * try: `status === 0` means "never reached the server" for every consumer, and
 * that is true of both. This tag is the discriminator.
 *
 * - `"transport"` — the network, or the server, is what got in the way. This is
 *   the default and it is correct for every other failure this client reports,
 *   including ones that did get a response, because "something went wrong
 *   talking to the server" is the useful description of all of them.
 * - `"unencodable-value"` — a value from the caller could not be encoded into
 *   the request path, so nothing was ever sent. Blaming the network for this
 *   is a false diagnosis, and the message is the only useful thing left.
 *
 * A named tag rather than a comparison on the message text, so that rewording a
 * message cannot silently change which failures are treated as offline.
 */
export type ApiClientFailure = "transport" | "unencodable-value";

/**
 * Every failure the app can see, in one type. `status === 0` means the request
 * never reached the server (offline, wrong host, backend down) and is distinct
 * from a real HTTP status so the UI can say "can't reach the server" rather
 * than inventing a server-side error message.
 */
export class ApiClientError extends Error {
  readonly status: number;

  /**
   * Only meaningful when `status === 0`, where it is the sole thing telling a
   * dead network apart from a request this client refused to build. For a real
   * HTTP status the answer is always `"transport"` and nothing should branch
   * on it.
   */
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
    // A call, not a reference: resolving `fetch` per request keeps the global
    // swappable after this module is imported, which is half of what makes the
    // client testable without a network.
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
      // A 2xx can still be unreadable: a wrong host — the Metro dev server on
      // :8081, say — or a proxy answers 200 with the router's HTML, and an
      // empty body parses as nothing at all. Left alone, the caller receives a
      // bare SyntaxError and "every failure is an ApiClientError" is a lie.
      throw new ApiClientError(
        `Malformed response from server (status ${response.status})`,
        response.status,
      );
    }
  }

  /**
   * No `id` is sent. The backend's `ScoreboardCreateRequest` types it as
   * required, but the column is `uuid().defaultRandom()` — a create without an
   * id makes drizzle emit `default` for that column and PostgreSQL generates the
   * UUID. Do not "fix" the type mismatch on this side by generating one here.
   * `code` is missing for the same reason — `generateCode()` generates it on the
   * server, and `ScoreboardCreateRequest` has no field for it at all. Anyone
   * diffing that DTO against the frontend `Scoreboard` meets two fields this
   * client declines to send, not one.
   */
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

/**
 * `encodeURIComponent` throws a `URIError` on an unpaired surrogate, and that is
 * reachable: a join code is typed into a text input, where a truncated character
 * survives trimming and a length check. Left alone it would escape as a raw
 * error from every method that puts a caller-supplied string in the path, so it
 * is wrapped once here.
 */
const encodePathSegment = (value: string): string => {
  try {
    return encodeURIComponent(value);
  } catch {
    // `status: 0` because the request is never sent, and `0` has to keep
    // meaning exactly that — so it cannot also be what tells this apart from a
    // real transport failure. `failure` can, and does: a UI that branches only
    // on `isOffline` still mislabels this as a dead network, so it has to read
    // the tag to keep the only diagnostic it was given.
    throw new ApiClientError(
      `Cannot build a request URL from ${JSON.stringify(value)}`,
      0,
      "unencodable-value",
    );
  }
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    // The backend's envelope is `{ message, code }`, but `code` is redundant
    // here: `runController` always sends `res.status(err.code)`, so the
    // transport status and the envelope's code cannot disagree — and when the
    // response did not come from this backend at all, only the status is real.
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === "string" && body.message.length > 0) {
      return body.message;
    }
  } catch {
    // Fall through to the generic message: a proxy error page is HTML, not JSON.
  }
  return `Request failed with status ${response.status}`;
};

export const apiClient = new ApiClient();
