//! Opt-in timing run using a temporary library and actual document APIs.
use super::{connection, refresh};
use crate::{documents, files, library};
use std::time::Instant;
fn stats(mut ms: Vec<f64>) -> serde_json::Value {
    ms.sort_by(f64::total_cmp);
    serde_json::json!({"n":ms.len(),"medianMs":ms[ms.len()/2],"p95Ms":ms[(ms.len()*95).div_ceil(100)-1]})
}
#[test]
#[ignore = "explicit synthetic 1,000-document task timing run"]
fn thousand_document_task_baseline() {
    let library_dir = tempfile::tempdir().unwrap();
    let data = library_dir.path();
    let mut first = None;
    let mut size = 0;
    for i in 0..1000 {
        let mut content = format!("# Plan {i} 🖋\n\n");
        for j in 0..5 {
            content.push_str(&format!("- [ ] 第 {j} 项工作 <!--inkstone-task:v1 {{\"id\":\"{}\",\"due\":\"2026-11-26\"}}-->\n",uuid::Uuid::new_v4()));
        }
        size += content.len();
        let d =
            library::create_document(data, "inbox", &format!("Plan-{i:04}.md"), &content).unwrap();
        if i == 0 {
            first = Some((d, content));
        }
    }
    let c = connection(data).unwrap();
    let initial = Instant::now();
    let view = refresh(data, "inbox").unwrap();
    let first_ms = initial.elapsed().as_secs_f64() * 1000.;
    assert_eq!(view.documents.len(), 1000);
    assert_eq!(
        view.documents
            .iter()
            .map(|d| d.task_rows.len())
            .sum::<usize>(),
        5000
    );
    let mut cold = vec![];
    let mut warm = vec![];
    let mut saved = vec![];
    let ws = documents::library_workspace(data, "inbox").unwrap();
    let (doc, mut content) = first.unwrap();
    for _ in 0..20 {
        c.execute("DELETE FROM task_documents_v1 WHERE project='inbox'", [])
            .unwrap();
        let t = Instant::now();
        let v = refresh(data, "inbox").unwrap();
        cold.push(t.elapsed().as_secs_f64() * 1000.);
        assert_eq!(
            v.documents.iter().map(|d| d.task_rows.len()).sum::<usize>(),
            5000
        );
        let t = Instant::now();
        let v = refresh(data, "inbox").unwrap();
        warm.push(t.elapsed().as_secs_f64() * 1000.);
        assert_eq!(v.documents.len(), 1000);
        let next = if content.contains("[x]") {
            content.replacen("[x]", "[ ]", 1)
        } else {
            content.replacen("[ ]", "[x]", 1)
        };
        let hash = files::hash(&content);
        let t = Instant::now();
        documents::save_if_clean(&ws, data, &doc.path, &next, &hash).unwrap();
        saved.push(t.elapsed().as_secs_f64() * 1000.);
        content = next;
    }
    println!(
        "TASK_BENCH {}",
        serde_json::json!({"documents":1000,"tasks":5000,"sourceBytes":size,"firstRefreshMs":first_ms,"rebuild":stats(cold),"cachedRefresh":stats(warm),"oneDocumentSave":stats(saved)})
    );
}
