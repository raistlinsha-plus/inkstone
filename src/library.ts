export interface LibraryProject {
  id: string;
  title: string;
}
export interface LibraryDocument {
  id: string;
  projectId: string;
  path: string;
  title: string;
  source: string;
  updated: number;
  opened: number;
  status: "ready" | "trashed";
}
export interface ImportTask {
  id: string;
  projectId: string;
  paths: string[];
  status: string;
}
export interface LibraryView {
  projects: LibraryProject[];
  documents: LibraryDocument[];
  pendingImports: ImportTask[];
}
export interface ImportItem {
  source: string;
  status: string;
  documentId: string | null;
  message: string;
}
export interface ImportResult {
  jobId: string;
  projectId: string;
  items: ImportItem[];
  warnings: string[];
  cancelled: boolean;
}
