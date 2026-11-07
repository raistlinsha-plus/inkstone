/** App orchestration boundary. Wire names/fields are unchanged; remaining dialogs migrate by domain. */
import { invoke as transport } from "@tauri-apps/api/core";
import type { LibraryView, LibraryDocument } from "../library";
import type { CalendarDocument } from "../content/calendar";
import type { RecoveryReport } from "../RecoveryDialog";
import type { ViewPreferences } from "../library/selectors";
import type {
  TrashDetail,
  PurgePreview,
  PurgeResult,
} from "../library/TrashDialog";
import type {
  Stats,
  IndexStatusSnapshot,
  Settings,
  Workspace,
  FileEntry,
  FileData,
  SaveResult,
  IndexPlan,
  Chunk,
  SearchResponse,
  ChatResponse,
} from "../types";
type Command<A, R> = { args: A; result: R };
type Scope = { scope?: string | null };
type Query = Scope & {
  semantic: boolean;
  retrievalMode: string;
  requestId: string;
};
export interface Commands {
  bootstrap: Command<
    undefined,
    { settings: Settings; lastWorkspace: string | null; dataDir?: string }
  >;
  index_stats: Command<undefined, Stats>;
  workspace_index_status: Command<undefined, IndexStatusSnapshot>;
  workspace_pins: Command<undefined, string[]>;
  library_recovery_report: Command<undefined, RecoveryReport>;
  workspace_set_pin: Command<{ id: string; pinned: boolean }, void>;
  library_list: Command<undefined, LibraryView>;
  library_get_view: Command<{ projectId: string }, ViewPreferences>;
  library_set_view: Command<
    { projectId: string; preferences: ViewPreferences },
    void
  >;
  library_trash_detail: Command<
    { projectId: string; documentId: string },
    TrashDetail
  >;
  library_purge_preview: Command<
    { projectId: string; documentId: string },
    PurgePreview
  >;
  library_purge_execute: Command<
    {
      projectId: string;
      documentId: string;
      token: string;
      operationId: string;
      confirmation: string;
    },
    PurgeResult
  >;
  library_purge_status: Command<
    { projectId: string; operationId: string },
    PurgeResult
  >;
  list_files: Command<undefined, FileEntry[]>;
  open_workspace: Command<{ root: string }, Workspace>;
  open_library: Command<{ projectId: string | null }, Workspace>;
  save_draft: Command<
    {
      path: string;
      content: string;
      baseHash: string;
      workspaceRoot: string | undefined;
    },
    void
  >;
  save_file: Command<
    {
      path: string;
      content: string;
      expectedHash: string;
      workspaceRoot: string | undefined;
    },
    SaveResult
  >;
  file_hash: Command<{ path: string }, string>;
  read_file: Command<{ path: string }, FileData>;
  create_file: Command<{ path: string; content?: string }, void>;
  discard_draft: Command<{ path: string }, void>;
  rename_file: Command<{ oldPath: string; newPath: string }, void>;
  library_trash: Command<{ id: string; restore: boolean }, void>;
  library_rename: Command<{ id: string; title: string }, void>;
  library_create_document: Command<
    {
      projectId: string;
      title: string;
      content?: string;
    },
    LibraryDocument
  >;
  library_reveal: Command<{ projectId: string }, void>;
  begin_index: Command<Scope, IndexPlan>;
  index_document: Command<
    {
      jobId: string;
      path: string;
      hash: string;
      chunks: Chunk[];
      manifest: { strategy: string; version: number; sourceHash: string };
    },
    number
  >;
  end_index: Command<{ jobId: string }, void>;
  cancel_search: Command<{ requestId: string }, void>;
  cancel_chat: Command<{ requestId: string }, void>;
  calendar_list: Command<
    { projectId: string },
    { documents: CalendarDocument[]; warnings: string[] }
  >;
  calendar_save: Command<
    {
      projectId: string;
      documentId: string;
      expectedHash: string;
      content: string;
    },
    SaveResult
  >;
  search: Command<Query & { query: string }, SearchResponse>;
  ask_question: Command<Query & { question: string }, ChatResponse>;
  cancel_import: Command<undefined, void>;
  cancel_index: Command<undefined, void>;
  clear_index: Command<undefined, void>;
  quit_app: Command<undefined, void>;
}
export function invoke<K extends keyof Commands>(
  command: K,
  ...args: Commands[K]["args"] extends undefined ? [] : [Commands[K]["args"]]
): Promise<Commands[K]["result"]> {
  return transport<Commands[K]["result"]>(command, args[0]);
}
