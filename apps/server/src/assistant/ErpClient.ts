import { AssistantError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";

// Laravel serializes decimal columns as strings.
const ErpNumber = Schema.Union([Schema.Finite, Schema.FiniteFromString]);

export const ErpClocking = Schema.Struct({
  id: Schema.Int,
  date: Schema.String,
  type: Schema.String,
  start_time: Schema.String,
  end_time: Schema.NullOr(Schema.String),
  hours: ErpNumber,
});
export type ErpClocking = typeof ErpClocking.Type;

export const ErpActiveClocking = Schema.Struct({
  data: Schema.NullOr(ErpClocking),
  meta: Schema.Struct({
    server_now: Schema.String,
    today_ordinary_hours: ErpNumber,
    today_required_hours: ErpNumber,
  }),
});
export type ErpActiveClocking = typeof ErpActiveClocking.Type;

const ErpReportSection = Schema.Literals(["yesterday", "today"]);
const ErpReportStatus = Schema.Literals(["new", "processing", "finished", "blocking"]);

export const ErpPrefillItem = Schema.Struct({
  section: ErpReportSection,
  project_id: Schema.NullOr(Schema.Int),
  project_other: Schema.NullOr(Schema.String),
  content: Schema.String,
  status: ErpReportStatus,
  sort_order: Schema.Int,
});
export type ErpPrefillItem = typeof ErpPrefillItem.Type;

export const ErpTodayReport = Schema.Struct({
  server_date: Schema.String,
  report: Schema.NullOr(Schema.Struct({ submitted_at: Schema.NullOr(Schema.String) })),
  prefill_items: Schema.Array(ErpPrefillItem),
  daily_report_exempt: Schema.Boolean,
});
export type ErpTodayReport = typeof ErpTodayReport.Type;

export const ErpActivity = Schema.Struct({
  title: Schema.String,
  status: Schema.NullOr(Schema.String),
  project_id: Schema.NullOr(Schema.Int),
  project_name: Schema.NullOr(Schema.String),
});
export type ErpActivity = typeof ErpActivity.Type;

const ErpProject = Schema.Struct({ id: Schema.Int, name: Schema.String });

export interface ErpDailyReportBody {
  readonly date: string;
  readonly problem_text?: string;
  readonly items: ReadonlyArray<{
    readonly section: "yesterday" | "today";
    readonly project_id?: number;
    readonly project_other?: string;
    readonly content: string;
    readonly status: "new" | "processing" | "finished" | "blocking";
    readonly sort_order: number;
  }>;
}

const ErrorBody = Schema.Struct({
  code: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  required_scopes: Schema.optional(Schema.Array(Schema.String)),
});
const decodeErrorBody = Schema.decodeUnknownOption(ErrorBody);

/** Single resources may arrive bare or wrapped in Laravel's `{ data }` envelope. */
const enveloped = <S extends Schema.Top>(schema: S) =>
  Schema.Union([Schema.Struct({ data: schema }), schema]);
const unwrap = <A>(value: { readonly data: A } | A, isWrapped: (value: unknown) => boolean) =>
  isWrapped(value) ? (value as { readonly data: A }).data : (value as A);

const REQUEST_TIMEOUT = "15 seconds";
const ERP_MESSAGE_LIMIT = 300;

const isHttpsUrl = (value: string) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

export class ErpClient extends Context.Service<
  ErpClient,
  {
    readonly getActiveClocking: () => Effect.Effect<ErpActiveClocking, AssistantError>;
    readonly listClockings: (
      month: string,
    ) => Effect.Effect<ReadonlyArray<ErpClocking>, AssistantError>;
    readonly clockIn: () => Effect.Effect<ErpClocking, AssistantError>;
    readonly clockOut: () => Effect.Effect<ErpClocking, AssistantError>;
    readonly getTodayReport: () => Effect.Effect<ErpTodayReport, AssistantError>;
    readonly listActivities: () => Effect.Effect<ReadonlyArray<ErpActivity>, AssistantError>;
    readonly listProjects: () => Effect.Effect<
      ReadonlyArray<{ readonly id: number; readonly name: string }>,
      AssistantError
    >;
    readonly submitReport: (body: ErpDailyReportBody) => Effect.Effect<void, AssistantError>;
  }
>()("t3/assistant/ErpClient") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const digest = yield* Digest.Digest;
  // ERP suspends a token after repeated rejections; stop calling it until the token changes.
  const suspendedTokenHash = yield* Ref.make<string | null>(null);

  const unavailable = (erpMessage: string) =>
    new AssistantError({ reason: "unavailable", erpMessage });

  const connection = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(() => unavailable("settings unavailable")),
    );
    const { erpBaseUrl, erpToken } = settings.assistant;
    // settings.json decodes any URL; only https may carry the token.
    if (erpBaseUrl === "" || erpToken === "" || !isHttpsUrl(erpBaseUrl)) {
      return yield* new AssistantError({ reason: "not-configured" });
    }
    const tokenHash = Hex.encode(
      yield* digest
        .digest(Digest.sha256, new TextEncoder().encode(erpToken))
        .pipe(Effect.mapError(() => unavailable("settings unavailable"))),
    );
    if ((yield* Ref.get(suspendedTokenHash)) === tokenHash) {
      return yield* new AssistantError({ reason: "suspended" });
    }
    return { baseUrl: erpBaseUrl.replace(/\/+$/u, ""), token: Redacted.make(erpToken), tokenHash };
  });

  const failureFor = Effect.fn("ErpClient.failureFor")(function* (
    response: HttpClientResponse.HttpClientResponse,
    tokenHash: string,
  ) {
    const body = decodeErrorBody(yield* response.json.pipe(Effect.orElseSucceed(() => undefined)));
    const parsed = body._tag === "Some" ? body.value : {};
    switch (response.status) {
      case 401:
        return new AssistantError({ reason: "unauthorized" });
      case 403:
        if (parsed.code === "suspended") {
          yield* Ref.set(suspendedTokenHash, tokenHash);
          return new AssistantError({ reason: "suspended" });
        }
        if (parsed.required_scopes !== undefined) {
          return new AssistantError({
            reason: "missing-scope",
            requiredScopes: parsed.required_scopes,
          });
        }
        return new AssistantError({ reason: "unauthorized" });
      case 422:
        return new AssistantError({
          reason: "rejected",
          ...(parsed.message === undefined
            ? {}
            : { erpMessage: parsed.message.slice(0, ERP_MESSAGE_LIMIT) }),
        });
      default:
        return unavailable(`HTTP ${response.status}`);
    }
  });

  const call = Effect.fn("ErpClient.call")(function* <S extends Schema.Top>(
    method: "GET" | "POST",
    path: string,
    schema: S,
    body?: unknown,
  ): Effect.fn.Return<S["Type"], AssistantError, S["DecodingServices"]> {
    const { baseUrl, token, tokenHash } = yield* connection;
    const url = `${baseUrl}/api/v1${path}`;
    const base = (method === "GET" ? HttpClientRequest.get(url) : HttpClientRequest.post(url)).pipe(
      HttpClientRequest.setHeader("Authorization", `Bearer ${Redacted.value(token)}`),
      HttpClientRequest.setHeader("Accept", "application/json"),
    );
    const request = body === undefined ? base : base.pipe(HttpClientRequest.bodyJsonUnsafe(body));
    const response = yield* http.execute(request).pipe(
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(() => unavailable("network error")),
    );
    if (response.status < 200 || response.status >= 300) {
      return yield* yield* failureFor(response, tokenHash);
    }
    const json = yield* response.json.pipe(
      Effect.mapError(() => unavailable("unexpected response")),
    );
    return yield* Schema.decodeEffect(schema)(json).pipe(
      Effect.mapError(() => unavailable("unexpected response")),
    );
  });

  const hasData = (value: unknown) =>
    typeof value === "object" && value !== null && "data" in value;
  const ClockingResponse = enveloped(ErpClocking);
  const ListOf = <S extends Schema.Top>(schema: S) =>
    Schema.Union([Schema.Struct({ data: Schema.Array(schema) }), Schema.Array(schema)]);

  return ErpClient.of({
    getActiveClocking: Effect.fn("ErpClient.getActiveClocking")(function* () {
      return yield* call("GET", "/profile/clockings/active", ErpActiveClocking);
    }),
    listClockings: Effect.fn("ErpClient.listClockings")(function* (month: string) {
      const listed = yield* call(
        "GET",
        `/profile/clockings?month=${encodeURIComponent(month)}`,
        ListOf(ErpClocking),
      );
      return unwrap(listed, hasData);
    }),
    clockIn: Effect.fn("ErpClient.clockIn")(function* () {
      return unwrap(
        yield* call("POST", "/profile/clockings/clock-in", ClockingResponse, { type: "ordinary" }),
        hasData,
      );
    }),
    clockOut: Effect.fn("ErpClient.clockOut")(function* () {
      return unwrap(
        yield* call("POST", "/profile/clockings/clock-out", ClockingResponse, {}),
        hasData,
      );
    }),
    getTodayReport: Effect.fn("ErpClient.getTodayReport")(function* () {
      return unwrap(
        yield* call("GET", "/profile/daily-reports/today", enveloped(ErpTodayReport)),
        (value) => hasData(value) && !("server_date" in (value as object)),
      );
    }),
    listActivities: Effect.fn("ErpClient.listActivities")(function* () {
      return unwrap(yield* call("GET", "/profile/activities", ListOf(ErpActivity)), hasData);
    }),
    listProjects: Effect.fn("ErpClient.listProjects")(function* () {
      return unwrap(yield* call("GET", "/lookup/projects", ListOf(ErpProject)), hasData);
    }),
    submitReport: Effect.fn("ErpClient.submitReport")(function* (body: ErpDailyReportBody) {
      yield* call("POST", "/profile/daily-reports", Schema.Unknown, body);
    }),
  });
});

export const layer = Layer.effect(ErpClient, make);
