import { t } from "~/i18n";

import { BINARY_PREVIEW_MAX_BYTES } from "./binaryPreviewProtocol";

export async function readBinaryPreview(src: string, signal: AbortSignal) {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(t("files.read.loadFailed"));
  if (Number(response.headers.get("content-length")) > BINARY_PREVIEW_MAX_BYTES)
    throw new Error(t("files.read.limit50Mb"));
  const reader = response.body?.getReader();
  if (!reader) throw new Error(t("files.read.unavailable"));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > BINARY_PREVIEW_MAX_BYTES) throw new Error(t("files.read.limit50Mb"));
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(chunks).arrayBuffer();
}
