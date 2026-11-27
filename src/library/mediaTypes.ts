export const imageName = (v: string) =>
  /\.(heic|heif|jpe?g|png|webp|gif)(?: 副本\d+)?\.md$/i.test(v);
export const mindName = (v: string) => /\.mindmap(?: 副本\d+)?\.md$/i.test(v);
export const label = (v: string) =>
  imageName(v) ? v.replace(/\.md$/i, "") : v;
export const isTaskNote = (path: string) =>
  /\.m(?:d|arkdown)$/i.test(path) && !imageName(path) && !mindName(path);
