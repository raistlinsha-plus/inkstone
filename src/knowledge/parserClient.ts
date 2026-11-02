import type { Chunk } from "../types";
import { documentKind } from "../session";
export function requestChunks(
  worker: Worker | null,
  id: number,
  content: string,
  path: string,
  max: number,
  parserError: string | null,
) {
  return new Promise<Chunk[]>((resolve, reject) => {
    if (parserError) {
      reject(new Error(parserError));
      return;
    }
    if (!worker) {
      reject(new Error("文档解析器未就绪"));
      return;
    }
    const timeout = setTimeout(() => {
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", onError);
      reject(new Error("文档解析超时"));
    }, 30000);
    const onError = (event: ErrorEvent) => {
      clearTimeout(timeout);
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", onError);
      reject(new Error(event.message || "后台文档解析失败"));
    };
    const handler = (event: MessageEvent) => {
      if (event.data.id !== id) return;
      clearTimeout(timeout);
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", onError);
      event.data.error
        ? reject(new Error(event.data.error))
        : resolve(event.data.chunks);
    };
    worker.addEventListener("message", handler);
    worker.addEventListener("error", onError);
    worker.postMessage({
      id,
      content,
      markdown: documentKind(path) === "markdown",
      path,
      max,
    });
  });
}
