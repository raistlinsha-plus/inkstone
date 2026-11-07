use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Clone)]
pub struct Workspace {
    pub root: PathBuf,
    pub db: PathBuf,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Provider {
    pub enabled: bool,
    pub base_url: String,
    pub model: String,
    pub dimensions: Option<usize>,
    pub max_input_chars: usize,
    pub batch_size: usize,
    pub context_chars: usize,
}
impl Default for Provider {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: "https://api.example.com/v1".into(),
            model: String::new(),
            dimensions: None,
            max_input_chars: 1800,
            batch_size: 8,
            context_chars: 16000,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct RerankProvider {
    pub enabled: bool,
    pub endpoint: String,
    pub protocol: String,
    pub model: String,
    pub candidate_count: usize,
    pub timeout_ms: u64,
    pub max_input_chars: usize,
    pub min_score: f64,
    pub strict: bool,
}
impl Default for RerankProvider {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: String::new(),
            protocol: "cohere".into(),
            model: String::new(),
            candidate_count: 40,
            timeout_ms: 3000,
            max_input_chars: 2400,
            min_score: 0.5,
            strict: false,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub embedding: Provider,
    pub chat: Provider,
    pub rerank: RerankProvider,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    pub embedding: Provider,
    pub chat: Provider,
    pub rerank: RerankProvider,
    pub has_embedding_key: bool,
    pub has_chat_key: bool,
    pub has_rerank_key: bool,
    pub key_warning: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub directory: bool,
    pub children: Vec<FileEntry>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub content: String,
    pub base_hash: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileData {
    pub path: String,
    pub content: String,
    pub hash: String,
    pub draft: Option<Draft>,
    pub missing: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChunkInput {
    pub text: String,
    pub heading: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChunkManifest {
    pub strategy: String,
    pub version: u32,
    pub source_hash: String,
    #[serde(default)]
    pub embedding_profile: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDocument {
    pub path: String,
    pub content: String,
    pub hash: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexPlan {
    pub job_id: String,
    pub documents: Vec<IndexDocument>,
    pub skipped: usize,
    pub warnings: Vec<String>,
    pub max_chunk_chars: usize,
    pub remote: bool,
}
#[derive(Clone)]
pub struct Job {
    pub id: String,
    pub root: PathBuf,
    pub profile: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: i64,
    pub path: String,
    pub text: String,
    pub heading: String,
    pub start_line: usize,
    pub end_line: usize,
    pub hash: String,
    pub score: f64,
    pub title: Option<String>,
    pub document_id: Option<String>,
    pub bm25_score: Option<f64>,
    pub vector_distance: Option<f64>,
    pub bm25_rank: Option<usize>,
    pub vector_rank: Option<usize>,
    pub rerank_score: Option<f64>,
    pub evidence: bool,
    pub match_kind: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub warning: Option<String>,
    pub semantic: bool,
    pub evidence_count: usize,
    pub candidate_count: usize,
    pub retrieval_mode: String,
    pub rerank_status: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub documents: usize,
    /// Indexed records, not a guarantee that every current file is fresh.
    pub keyword_documents: usize,
    /// Documents with a complete vector write for the selected model profile.
    pub vector_documents: usize,
    pub total_documents: Option<usize>,
    pub chunks: usize,
    pub vectors: usize,
    pub embedding_ready: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatEvent {
    pub request_id: String,
    pub delta: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory: Option<crate::assistant::memory::Usage>,
    pub finish_reason: String,
    pub text: String,
    pub sources: Vec<SearchResult>,
    pub warning: Option<String>,
    pub retrieval_mode: String,
    pub rerank_status: String,
    /// Empty when no generation request was made (for example, no evidence).
    pub model: String,
    pub scope: Option<String>,
    pub chart_warnings: Vec<String>,
    pub rejected_charts: Vec<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStatusEvent {
    pub request_id: String,
    pub stage: String,
    pub detail: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSourcesEvent {
    pub request_id: String,
    pub sources: Vec<SearchResult>,
}
