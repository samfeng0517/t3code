import { t } from "~/i18n";
import { readBinaryPreview } from "./readBinaryPreview";

export async function decodeImagePreview(src: string, heif: boolean, signal: AbortSignal) {
  const worker = new Worker(new URL("./imageDecode.worker.ts", import.meta.url), {
    type: "module",
  });
  const controller = new AbortController();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const fail = (message: string) => reject(new Error(message));
      const abort = () => fail(t("files.image.decodeCancelled"));
      signal.addEventListener("abort", abort, { signal: controller.signal });
      if (signal.aborted) return abort();
      const timer = setTimeout(() => fail(t("files.image.decodeTimedOut")), 30_000);
      controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
      worker.addEventListener("error", () => fail(t("files.image.decoderLoadFailed")));
      worker.addEventListener("message", (event: MessageEvent<{ blob?: Blob; error?: string }>) => {
        if (event.data.blob) resolve(event.data.blob);
        else fail(event.data.error ?? t("files.image.decodeFailed"));
      });
      void readBinaryPreview(src, controller.signal).then(
        (bytes) => worker.postMessage({ bytes, heif }, [bytes]),
        reject,
      );
    });
  } finally {
    controller.abort();
    worker.terminate();
  }
}
