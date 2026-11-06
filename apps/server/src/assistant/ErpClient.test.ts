import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSettings from "../serverSettings.ts";
import * as ErpClient from "./ErpClient.ts";

const TOKEN = "erp-test-token";

interface Recorded {
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
}

const harness = (
  respond: (url: string, headers: Readonly<Record<string, string>>) => Response,
  assistant: { readonly erpBaseUrl?: string; readonly erpToken?: string } = {},
) => {
  const requests: Array<Recorded> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({ url: request.url, method: request.method, headers: request.headers });
      return HttpClientResponse.fromWeb(request, respond(request.url, request.headers));
    }),
  );
  const layer = ErpClient.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        NodeCrypto.layer,
        ServerSettings.layerTest({
          assistant: { erpBaseUrl: "https://erp.example.com", erpToken: TOKEN, ...assistant },
        }),
      ),
    ),
  );
  return { requests, layer };
};

const activeBody = {
  data: null,
  meta: {
    server_now: "2026-11-05T01:00:00+00:00",
    today_ordinary_hours: "2.98",
    today_required_hours: 8,
  },
};

describe("ErpClient", () => {
  it.effect(
    "ErpClient should send Bearer and Accept headers and no Origin when calling a GET endpoint",
    () => {
      const { requests, layer } = harness(() => Response.json(activeBody));
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        const active = yield* erp.getActiveClocking();
        assert.equal(active.meta.today_ordinary_hours, 2.98);
        assert.lengthOf(requests, 1);
        const [request] = requests;
        assert.equal(request!.url, "https://erp.example.com/api/v1/profile/clockings/active");
        assert.equal(request!.headers.authorization, `Bearer ${TOKEN}`);
        assert.equal(request!.headers.accept, "application/json");
        assert.notProperty(request!.headers, "origin");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "ErpClient should fail not-configured without a request when the token is empty",
    () => {
      const { requests, layer } = harness(() => Response.json(activeBody), { erpToken: "" });
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        assert.equal((yield* Effect.flip(erp.clockIn())).reason, "not-configured");
        assert.lengthOf(requests, 0);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "ErpClient should fail not-configured without a request when the saved erpBaseUrl is http",
    () => {
      const { requests, layer } = harness(() => Response.json(activeBody), {
        erpBaseUrl: "http://erp.example.com",
      });
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        assert.equal((yield* Effect.flip(erp.getActiveClocking())).reason, "not-configured");
        assert.lengthOf(requests, 0);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "ErpClient should map 403 required_scopes to missing-scope when ERP lacks a scope",
    () => {
      const { layer } = harness(() =>
        Response.json(
          {
            message: "This token is missing a required scope.",
            required_scopes: ["daily-reports:write"],
          },
          { status: 403 },
        ),
      );
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        const error = yield* Effect.flip(erp.getTodayReport());
        assert.equal(error.reason, "missing-scope");
        assert.deepEqual(error.requiredScopes, ["daily-reports:write"]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "ErpClient should stop calling ERP when a 403 suspended was returned for the same token",
    () => {
      const { requests, layer } = harness(() =>
        Response.json({ code: "suspended", reason: "rate", until: null }, { status: 403 }),
      );
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        assert.equal((yield* Effect.flip(erp.getActiveClocking())).reason, "suspended");
        assert.equal((yield* Effect.flip(erp.clockIn())).reason, "suspended");
        assert.equal((yield* Effect.flip(erp.listProjects())).reason, "suspended");
        assert.lengthOf(requests, 1);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "ErpClient should map 422 to rejected with the ERP message when clock-in is refused",
    () => {
      const { requests, layer } = harness((url) =>
        Response.json(
          { message: url.endsWith("/clock-in") ? "已有進行中的打卡" : "x".repeat(400) },
          { status: 422 },
        ),
      );
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        const error = yield* Effect.flip(erp.clockIn());
        assert.equal(error.reason, "rejected");
        assert.equal(error.erpMessage, "已有進行中的打卡");
        assert.equal(requests[0]?.method, "POST");
        assert.equal(requests[0]?.headers["content-type"], "application/json");
        assert.lengthOf((yield* Effect.flip(erp.clockOut())).erpMessage ?? "", 300);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect.each([
    { status: 401, reason: "unauthorized", erpMessage: undefined },
    { status: 429, reason: "unavailable", erpMessage: "HTTP 429" },
    { status: 503, reason: "unavailable", erpMessage: "HTTP 503" },
  ] as const)(
    "ErpClient should map $status to $reason and make exactly one request when ERP refuses",
    ({ status, reason, erpMessage }) => {
      const { requests, layer } = harness(() => new Response("refused", { status }));
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        const error = yield* Effect.flip(erp.getActiveClocking());
        assert.equal(error.reason, reason);
        assert.equal(error.erpMessage, erpMessage);
        assert.lengthOf(requests, 1);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("ErpClient should call ERP again when the token changes after a suspension", () => {
    let suspended = true;
    const { requests, layer } = harness((_url, headers) =>
      suspended && headers.authorization === `Bearer ${TOKEN}`
        ? Response.json({ code: "suspended" }, { status: 403 })
        : Response.json(activeBody),
    );
    return Effect.gen(function* () {
      const erp = yield* ErpClient.ErpClient;
      const settings = yield* ServerSettings.ServerSettingsService;
      assert.equal((yield* Effect.flip(erp.getActiveClocking())).reason, "suspended");
      suspended = false;
      yield* settings.updateSettings({ assistant: { erpToken: "erp-other-token" } });
      yield* erp.getActiveClocking();
      yield* settings.updateSettings({ assistant: { erpToken: TOKEN } });
      yield* erp.getActiveClocking();
      assert.lengthOf(requests, 3);
    }).pipe(Effect.provide(layer));
  });

  it.effect(
    "ErpClient should accept a list bare or wrapped in data when ERP returns either",
    () => {
      const projects = [{ id: 7, name: "Example" }];
      const clocking = {
        id: 1,
        date: "2026-11-05",
        type: "ordinary",
        start_time: "2026-11-05T09:00:00+08:00",
        end_time: null,
        hours: "0.00",
      };
      const { layer } = harness((url) =>
        url.endsWith("/lookup/projects")
          ? Response.json(projects)
          : url.endsWith("/clock-in")
            ? Response.json({ data: clocking })
            : Response.json({ data: projects }),
      );
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        assert.deepEqual(yield* erp.listProjects(), projects);
        assert.equal((yield* erp.clockIn()).hours, 0);
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect("ErpClient should fail with network error when the response body stalls", () => {
    const { layer } = harness(
      () => new Response(new ReadableStream({ start: () => undefined }), { status: 200 }),
    );
    return Effect.gen(function* () {
      const erp = yield* ErpClient.ErpClient;
      const fiber = yield* Effect.forkChild(Effect.flip(erp.getActiveClocking()));
      yield* TestClock.adjust("15 seconds");
      const error = yield* Fiber.join(fiber);
      assert.equal(error.erpMessage, "network error");
    }).pipe(Effect.provide(layer));
  });

  it.effect("ErpClient should not include the token in the error when any request fails", () => {
    const { layer } = harness((url) =>
      url.endsWith("/clock-in")
        ? Response.json({ message: `bad token ${TOKEN}` }, { status: 401 })
        : Response.json({ unexpected: true }),
    );
    return Effect.gen(function* () {
      const erp = yield* ErpClient.ErpClient;
      for (const error of [
        yield* Effect.flip(erp.clockIn()),
        yield* Effect.flip(erp.getActiveClocking()),
      ]) {
        assert.notInclude(JSON.stringify(error), TOKEN);
        assert.notInclude(String(error), TOKEN);
        assert.notInclude(JSON.stringify(error), "erp.example.com");
      }
    }).pipe(Effect.provide(layer));
  });
});
