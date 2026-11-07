use super::Pending;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub enabled: bool,
    pub character_id: String,
    pub mode: String,
    pub reduced_motion: bool,
    pub compact: bool,
}

#[derive(Clone, Serialize, Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RoleProgress {
    pub read: Vec<u8>,
    pub choices: BTreeMap<String, String>,
    pub outfit: u8,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Ledger {
    pub id: String,
    pub receipt_id: String,
    pub doc_id: String,
    pub space_id: String,
    pub hash: String,
    pub day: String,
    pub kind: String,
    pub character_id: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub text: String,
    pub space_id: String,
    pub day: String,
    pub character_id: String,
    pub kind: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preference {
    pub id: String,
    pub key: String,
    pub value: String,
    pub scope: String,
    pub scope_id: String,
    pub enabled: bool,
    pub updated: i64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub generation: String,
    pub revision: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub generation: String,
    pub revision: u64,
    pub timezone: String,
    pub settings: Settings,
    pub events: usize,
    pub days: usize,
    pub roles: BTreeMap<String, RoleProgress>,
    pub cards: Vec<Card>,
    pub preferences: Vec<Preference>,
    #[serde(default)]
    pub recall_enabled: bool,
    pub pending: Vec<Pending>,
    pub eligible: Option<u8>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub token: String,
    pub event_id: String,
    pub suggested_text: String,
    pub day: String,
    pub can_revise: bool,
    pub expires_at: i64,
    pub context: Context,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsInput {
    pub context: Context,
    pub enabled: bool,
    pub character_id: String,
    pub mode: String,
    pub reduced_motion: bool,
    pub compact: bool,
    pub outfit: Option<u8>,
    pub timezone: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmInput {
    pub context: Context,
    pub token: String,
    pub event_id: String,
    pub text: String,
    pub kind: String,
    pub consent: bool,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmResult {
    pub status: String,
    pub snapshot: Snapshot,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryInput {
    pub context: Context,
    pub character_id: String,
    pub stage: u8,
    pub skipped: bool,
    pub choice_id: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardInput {
    pub context: Context,
    pub id: String,
    pub text: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreferenceInput {
    pub context: Context,
    pub id: Option<String>,
    pub key: String,
    pub value: String,
    pub scope: String,
    pub scope_id: String,
    pub enabled: bool,
    pub delete: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: false,
            character_id: "motuan".into(),
            mode: "focus".into(),
            reduced_motion: true,
            compact: true,
        }
    }
}
