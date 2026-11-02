import { chunkDocument } from "./document";
import { chunkStructured } from "./content/indexing";
self.onmessage = (
  event: MessageEvent<{
    id: number;
    content: string;
    markdown: boolean;
    path?: string;
    max: number;
  }>,
) => {
  const { id, content, markdown, max } = event.data;
  try {
    self.postMessage({
      id,
      manifest: { strategy: "structured", version: 1 },
      chunks: event.data.path
        ? chunkStructured(content, event.data.path, max)
        : chunkDocument(content, markdown, max),
    });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
