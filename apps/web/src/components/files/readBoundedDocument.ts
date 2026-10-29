import { t } from "~/i18n";

export async function readBoundedDocument(
  src: string,
  signal: AbortSignal,
  limit: number,
  cache: RequestCache = "default",
) {
  const response = await fetch(src, { signal, cache });
  if (!response.ok || Number(response.headers.get("content-length")) > limit)
    throw new Error(t("files.read.unavailableOrLarge"));
  const reader = response.body?.getReader();
  if (!reader) throw new Error(t("files.read.fileUnavailable"));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error(t("files.read.tooLarge"));
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(chunks).arrayBuffer();
}
