//! Optional release acceptance with a user's address-bound service and synthetic sources.
use crate::{
    assistant, assistant_runtime,
    assistant_sources::{Selection, WebAccess},
    credentials, eval_trace, evaluation_v086, library,
};
use serde_json::{json, Value};

const BRIEF: &str = "# 合成试用简报\n青岚资料室开放至 19:30，日常入口在北门。\n青岚资料室的备用入口是西侧连廊。\n松塔档案室开放至 18:45，日常入口在南门，备用入口是西门。";

async fn evaluate(vision: bool) {
    assert_eq!(std::env::var("INKSTONE_WORKBENCH_LIVE").as_deref(), Ok("1"));
    let report = std::env::var("INKSTONE_WORKBENCH_REPORT").expect("receipt path");
    assert!(
        !std::path::Path::new(&report).exists(),
        "receipt already exists"
    );
    let mut config = evaluation_v086::saved_settings().expect("saved settings");
    assert!(config.chat.enabled);
    config.candidate_reading = false;
    let data = tempfile::tempdir().unwrap();
    let state = evaluation_v086::isolated_state(
        data.path(),
        config.clone(),
        credentials::CredentialReader::default(),
    )
    .unwrap();
    let cred = evaluation_v086::saved_credential_directory().unwrap();
    let mut rows = vec![];
    evaluation_v086::CREDENTIAL_DIRECTORY.scope(cred,async {
        let key=evaluation_v086::saved_key(&state,"chat",&config.chat.base_url).await.expect("address-bound chat credential");
        drop(key);
        let note=library::create_document(data.path(),"inbox","合成简报.md",if vision {"# 合成会议笔记\n这次会议的项目代号为 MICA-71。"} else {BRIEF}).unwrap();
        let mut c=assistant::create(data.path(),assistant::GENERAL_OWNER,None,"合成验收".into(),None).unwrap();
        let questions=if vision {vec!["请指出图片上的英文标题及年份，并从会议笔记找出项目代号。每项分别附引用。"]} else {vec!["请用一句话总结青岚资料室的开放截止时间与日常入口，并附引用。","那它的备用入口呢？请用一句话总结并标注出处。"]};
        let mut selected=Selection{project_id:Some("inbox".into()),document_ids:vec![note.id.clone()],..Default::default()};
        let photo = if vision {
            let fixture = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/native/fixtures/media-board.png"));
            let photo = crate::media::import_into_folder(data.path(), "inbox", fixture, false, "").unwrap().document;
            let preview = crate::assistant_images::preview(data.path(), "inbox", &photo.id).unwrap();
            selected.document_ids.push(photo.id.clone());
            selected.image = Some(crate::assistant_images::ImageSelection { document_id:photo.id.clone(), mode:crate::assistant_images::ImageMode::Vision });
            Some((photo.id,preview.hash))
        } else {None};
        for (index,q) in questions.iter().enumerate(){
            let request=format!("live-workbench-{index}");
            let mut started=assistant::begin_with_sources(data.path(),assistant::GENERAL_OWNER,&c.id,c.revision,q,c.active_leaf_id.as_deref(),None,&request,"keyword",Some(selected.clone()),Some(WebAccess::LocalOnly)).unwrap();
            if let Some((id, hash))=&photo {
                started.vision_consent = Some(crate::assistant_images::VisionConsent { document_id:id.clone(), preview_hash:hash.clone(),base_url:config.chat.base_url.clone(),model:config.chat.model.clone() });
            }
            let trace=eval_trace::Trace::new(1,45);
            let result=eval_trace::TRACE.scope(trace.clone(),assistant_runtime::general(None,&state,&started,&request,"keyword",&Default::default())).await;
            let mut row=json!({"question":q,"transport":trace.snapshot(),"completed":result.is_ok()});
            match &result {
                Ok(answer) => {
                    let citations=crate::answer_validation::cited_numbers(&answer.text);
                    let sources=answer.external_sources.iter().map(|s|json!({"source":if s.document_id.as_ref()==Some(&note.id) {"note"} else {"image"},"number":s.citation,"cited":citations.contains(&s.citation),"excerpt":s.excerpt})).collect::<Vec<_>>();
                    row["answer"]=Value::String(answer.text.clone());row["sources"]=json!(sources);row["finish"]=json!(answer.finish_reason);
                }
                Err(_) => {row["failure"]=json!("provider or local request did not complete");}
            }
            rows.push(row);
            if result.is_err() {break;}
            c=assistant::finish(data.path(),assistant::GENERAL_OWNER,&started,result.as_ref().map_err(String::as_str),false).unwrap();
        }
    }).await;
    let report_data = json!({"model":config.chat.model,"syntheticOnly":true,"fixtureHash":crate::files::hash(BRIEF),"rows":rows});
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(report)
        .unwrap();
    file.write_all(&serde_json::to_vec_pretty(&report_data).unwrap())
        .unwrap();
}

#[tokio::test]
#[ignore = "Uses an explicitly authorized chat model, up to two HTTP attempts"]
async fn live_workbench_notes() {
    evaluate(false).await;
}

#[tokio::test]
#[ignore = "Uses an explicitly authorized vision model, one synthetic image and one HTTP attempt"]
async fn live_workbench_vision() {
    evaluate(true).await;
}
