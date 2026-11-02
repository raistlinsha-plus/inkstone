//! Test-only HTTP attempt budget. No credentials, URLs, bodies or private settings recorded.
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
tokio::task_local! { pub static TRACE: Arc<Trace>; }
pub struct Trace {
    started: Instant,
    limit: usize,
    deadline: Duration,
    rows: Mutex<Vec<Value>>,
}
impl Trace {
    pub fn new(limit: usize, seconds: u64) -> Arc<Self> {
        Arc::new(Self {
            started: Instant::now(),
            limit,
            deadline: Duration::from_secs(seconds),
            rows: Mutex::new(vec![]),
        })
    }
    pub fn snapshot(&self) -> Value {
        let rows = self.rows.lock().unwrap();
        json!({"httpAttempts":rows.len(),"maxHttpAttempts":self.limit,"maxWallSeconds":self.deadline.as_secs(),"wallMs":self.started.elapsed().as_millis(),"attempts":*rows,"providerBilledCost":null,"tokens":null})
    }
}
pub struct Attempt {
    trace: Arc<Trace>,
    index: usize,
    started: Instant,
}
pub fn begin(stage: &str) -> Result<Option<Attempt>, String> {
    TRACE
        .try_with(|trace| {
            let mut rows = trace.rows.lock().unwrap();
            if rows.len() >= trace.limit || trace.started.elapsed() >= trace.deadline {
                return Err("评测请求数或时间预算已到，未发送更多请求".into());
            }
            let index = rows.len();
            rows.push(
                json!({"stage":stage,"status":"in-flight","httpStatus":null,"headersMs":null}),
            );
            Ok(Some(Attempt {
                trace: trace.clone(),
                index,
                started: Instant::now(),
            }))
        })
        .unwrap_or(Ok(None))
}
impl Attempt {
    pub fn response(&self, status: u16) {
        let mut rows = self.trace.rows.lock().unwrap();
        rows[self.index]["status"] = json!("response");
        rows[self.index]["httpStatus"] = json!(status);
        rows[self.index]["headersMs"] = json!(self.started.elapsed().as_millis());
    }
}
impl Drop for Attempt {
    fn drop(&mut self) {
        let mut rows = self.trace.rows.lock().unwrap();
        if rows[self.index]["status"] == "in-flight" {
            rows[self.index]["status"] = json!("network-error-or-cancelled");
        }
    }
}
#[tokio::test]
async fn attempt_budget_is_task_scoped_and_never_records_credentials() {
    assert!(begin("outside").unwrap().is_none());
    let t = Trace::new(1, 10);
    TRACE
        .scope(t.clone(), async {
            let a = begin("embeddings").unwrap().unwrap();
            a.response(429);
            drop(a);
            assert!(begin("retry").is_err());
        })
        .await;
    assert_eq!(t.snapshot()["httpAttempts"], 1);
    assert_eq!(t.snapshot()["attempts"][0]["httpStatus"], 429);
}
