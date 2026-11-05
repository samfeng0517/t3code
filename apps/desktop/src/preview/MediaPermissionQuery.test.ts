import { assert, describe, it } from "@effect/vitest";

import { installMediaPermissionQuery } from "./MediaPermissionQuery.ts";

class FakeStatus {
  native: PermissionState;
  constructor(native: PermissionState) {
    this.native = native;
  }
  get state(): PermissionState {
    return this.native;
  }
}

const install = (native: PermissionState, answer: unknown) => {
  const asked: Array<string> = [];
  class FakePermissions {
    async query(_descriptor: PermissionDescriptor) {
      return new FakeStatus(native);
    }
  }
  installMediaPermissionQuery(
    async (device) => {
      asked.push(device);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    {
      Permissions: FakePermissions as unknown as { prototype: Permissions },
      PermissionStatus: FakeStatus as unknown as { prototype: PermissionStatus },
    },
  );
  const query = (name: string) =>
    new FakePermissions().query({ name } as PermissionDescriptor) as Promise<FakeStatus>;
  return { query, asked };
};

describe("installMediaPermissionQuery", () => {
  it("should report prompt for an undecided device when Electron reports denied", async () => {
    const { query, asked } = install("denied", "prompt");
    const status = await query("camera");
    assert.strictEqual(status.state, "prompt");
    status.native = "granted";
    assert.strictEqual(status.state, "granted");
    assert.deepStrictEqual(asked, ["camera"]);
  });

  it("should keep the native source text when a page inspects the wrapped query", () => {
    class NativePermissions {
      query() {
        return Promise.resolve(new FakeStatus("granted"));
      }
    }
    const nativeSource = NativePermissions.prototype.query.toString();
    installMediaPermissionQuery(async () => "prompt", {
      Permissions: NativePermissions as unknown as { prototype: Permissions },
      PermissionStatus: FakeStatus as unknown as { prototype: PermissionStatus },
    });
    assert.strictEqual(NativePermissions.prototype.query.toString(), nativeSource);
  });

  it("should keep the native state when the device was blocked, the lookup fails or the permission is not media", async () => {
    assert.strictEqual((await install("denied", "denied").query("microphone")).state, "denied");
    assert.strictEqual(
      (await install("denied", new Error("ipc failed")).query("camera")).state,
      "denied",
    );
    const other = install("denied", "prompt");
    assert.strictEqual((await other.query("geolocation")).state, "denied");
    const granted = install("granted", "prompt");
    assert.strictEqual((await granted.query("camera")).state, "granted");
    assert.deepStrictEqual([...other.asked, ...granted.asked], []);
  });
});
