import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  respond: (url: string) => Response,
  assistant: { readonly erpBaseUrl?: string; readonly erpToken?: string } = {},
) => {
  const requests: Array<Recorded> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({ url: request.url, method: request.method, headers: request.headers });
      return HttpClientResponse.fromWeb(request, respond(request.url));
    }),
  );
  const layer = ErpClient.layer.pipe(
    Layer.provide(
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
    "ErpClient should send Bearer and Accept headers and no Origin when calling any endpoint",
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
      const { requests, layer } = harness(() =>
        Response.json({ message: "已有進行中的打卡" }, { status: 422 }),
      );
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        const error = yield* Effect.flip(erp.clockIn());
        assert.equal(error.reason, "rejected");
        assert.equal(error.erpMessage, "已有進行中的打卡");
        assert.equal(requests[0]?.method, "POST");
      }).pipe(Effect.provide(layer));
    },
  );

  it.effect(
    "ErpClient should map 503 to unavailable and make exactly one request when ERP is down",
    () => {
      const { requests, layer } = harness(() => new Response("down", { status: 503 }));
      return Effect.gen(function* () {
        const erp = yield* ErpClient.ErpClient;
        const error = yield* Effect.flip(erp.getActiveClocking());
        assert.equal(error.reason, "unavailable");
        assert.equal(error.erpMessage, "HTTP 503");
        assert.lengthOf(requests, 1);
      }).pipe(Effect.provide(layer));
    },
  );

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
