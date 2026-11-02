//! Process-only credential reads. A timed-out OS authentication is still in flight.
//! Never spawn a second blocking read until it finishes; no secrets are serialized.
use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::watch;

pub const PENDING: &str = "钥匙串正在等待系统授权；完成授权后重试，本地编辑和关键词检索可继续。";
type ResultValue = Result<Option<String>, String>;
#[derive(Clone, Hash, PartialEq, Eq)]
pub struct Identity {
    role: String,
    address: String,
    legacy: bool,
}
impl Identity {
    pub fn new(role: &str, address: &str, legacy: bool) -> Self {
        Self {
            role: role.into(),
            address: address.into(),
            legacy,
        }
    }
}
struct Flight {
    identity: Identity,
    epoch: u64,
    started: Instant,
    result: watch::Sender<Option<ResultValue>>,
}
struct Cached {
    value: Option<String>,
    expires: Instant,
}
#[derive(Default)]
struct State {
    epoch: u64,
    cached: HashMap<Identity, Cached>,
    flight: Option<Arc<Flight>>,
    failed: Option<(Identity, Instant)>,
}
#[derive(Clone)]
pub struct CredentialReader {
    state: Arc<Mutex<State>>,
    ttl: Duration,
    wait: Duration,
}
impl Default for CredentialReader {
    fn default() -> Self {
        Self::new(Duration::from_secs(300), Duration::from_secs(4))
    }
}
impl CredentialReader {
    fn new(ttl: Duration, wait: Duration) -> Self {
        Self {
            state: Arc::new(Mutex::new(State::default())),
            ttl,
            wait,
        }
    }
    pub fn invalidate(&self) {
        if let Ok(mut state) = self.state.lock() {
            state.epoch = state.epoch.wrapping_add(1);
            state.cached.clear();
            state.failed = None;
            // The OS may still own a prompt. Keep its slot until the real call finishes.
        }
    }
    pub fn pending(&self) -> bool {
        self.state
            .lock()
            .map(|s| s.flight.is_some())
            .unwrap_or(true)
    }
    pub async fn read<F>(&self, identity: Identity, cancel: &AtomicBool, reader: F) -> ResultValue
    where
        F: FnOnce() -> ResultValue + Send + 'static,
    {
        if cancel.load(Ordering::SeqCst) {
            return Err("操作已取消".into());
        }
        let (flight, launch) = {
            let mut state = self.state.lock().map_err(|_| "凭据读取状态不可用")?;
            let now = Instant::now();
            state.cached.retain(|_, v| v.expires > now);
            if let Some(cached) = state.cached.get(&identity) {
                return Ok(cached.value.clone());
            }
            if state
                .failed
                .as_ref()
                .is_some_and(|(key, until)| key == &identity && *until > now)
            {
                return Err("钥匙串暂不可用，请稍后重试；本地编辑和关键词检索可继续。".into());
            }
            if let Some(flight) = &state.flight {
                if flight.identity != identity
                    || flight.epoch != state.epoch
                    || flight.started.elapsed() >= self.wait
                {
                    return Err(PENDING.into());
                }
                (flight.clone(), false)
            } else {
                let (result, _) = watch::channel(None);
                let flight = Arc::new(Flight {
                    identity,
                    epoch: state.epoch,
                    started: now,
                    result,
                });
                state.flight = Some(flight.clone());
                (flight, true)
            }
        };
        if launch {
            let shared = self.state.clone();
            let current = flight.clone();
            let ttl = self.ttl;
            // Keep management alive even when the calling future is cancelled or times out.
            tokio::task::spawn_blocking(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(reader))
                    .unwrap_or_else(|_| Err("钥匙串读取失败".into()));
                if let Ok(mut state) = shared.lock() {
                    if state.epoch == current.epoch {
                        match &result {
                            Ok(value) => {
                                state.cached.insert(
                                    current.identity.clone(),
                                    Cached {
                                        value: value.clone(),
                                        expires: Instant::now()
                                            + if value.is_some() {
                                                ttl
                                            } else {
                                                ttl.min(Duration::from_secs(30))
                                            },
                                    },
                                );
                            }
                            Err(_) => {
                                state.failed = Some((
                                    current.identity.clone(),
                                    Instant::now() + Duration::from_secs(15),
                                ))
                            }
                        }
                    }
                    if state
                        .flight
                        .as_ref()
                        .is_some_and(|f| Arc::ptr_eq(f, &current))
                    {
                        state.flight = None;
                    }
                    let result = if state.epoch == current.epoch {
                        result
                    } else {
                        Err("凭据配置已变化，请重新操作。".into())
                    };
                    current.result.send_replace(Some(result));
                } else {
                    current
                        .result
                        .send_replace(Some(Err("凭据读取状态不可用".into())));
                }
            });
        }
        let mut receiver = flight.result.subscribe();
        let remaining = self.wait.saturating_sub(flight.started.elapsed());
        let operation = async {
            loop {
                if let Some(value) = receiver.borrow().clone() {
                    if self.state.lock().map_err(|_| "凭据读取状态不可用")?.epoch != flight.epoch
                    {
                        return Err("凭据配置已变化，请重新操作。".into());
                    }
                    return value;
                }
                receiver
                    .changed()
                    .await
                    .map_err(|_| "凭据读取中断".to_string())?;
            }
        };
        tokio::select! {
            result=tokio::time::timeout(remaining,operation)=>result.unwrap_or_else(|_|Err(PENDING.into())),
            _=async { while !cancel.load(Ordering::SeqCst) {tokio::time::sleep(Duration::from_millis(20)).await;} }=>Err("操作已取消".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    #[tokio::test]
    async fn simultaneous_same_identity_reads_share_one_result_and_failures_cool_down() {
        let reader = CredentialReader::new(Duration::from_secs(1), Duration::from_millis(200));
        let id = Identity::new("chat", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let first = reader.read(id.clone(), &cancel, || {
            std::thread::sleep(Duration::from_millis(30));
            Ok(Some("same".into()))
        });
        let second = reader.read(id.clone(), &cancel, || panic!("must join"));
        let (a, b) = tokio::join!(first, second);
        assert_eq!(a.unwrap(), b.unwrap());
        reader.invalidate();
        assert!(reader
            .read(id.clone(), &cancel, || Err("native denied".into()))
            .await
            .is_err());
        assert!(reader
            .read(id, &cancel, || panic!("must cool down"))
            .await
            .unwrap_err()
            .contains("暂不可用"));
    }
    #[tokio::test]
    async fn single_flight_timeout_cancellation_and_late_success_do_not_stack_os_reads() {
        let reader = CredentialReader::new(Duration::from_secs(1), Duration::from_millis(40));
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let id = Identity::new("chat", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let error = reader
            .read(id.clone(), &cancel, move || {
                c.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(100));
                Ok(Some("test-secret".into()))
            })
            .await
            .unwrap_err();
        assert_eq!(error, PENDING);
        assert!(reader.pending());
        assert_eq!(
            reader
                .read(id.clone(), &cancel, || panic!(
                    "must not start another call"
                ))
                .await
                .unwrap_err(),
            PENDING
        );
        assert_eq!(
            reader
                .read(
                    Identity::new("embedding", "https://b.invalid/v1", false),
                    &cancel,
                    || panic!("global slot remains occupied")
                )
                .await
                .unwrap_err(),
            PENDING
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(
            reader
                .read(id, &cancel, || panic!("must use late successful result"))
                .await
                .unwrap()
                .as_deref(),
            Some("test-secret")
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn same_identity_joins_and_configuration_invalidation_rejects_late_secrets() {
        let reader = CredentialReader::new(Duration::from_secs(1), Duration::from_millis(200));
        let id = Identity::new("chat", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let first = reader.read(id.clone(), &cancel, || {
            std::thread::sleep(Duration::from_millis(60));
            Ok(Some("old".into()))
        });
        let second = async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            reader.invalidate();
            reader
                .read(id.clone(), &cancel, || panic!("old read owns slot"))
                .await
        };
        let (a, b) = tokio::join!(first, second);
        assert!(a.unwrap_err().contains("配置已变化"));
        assert_eq!(b.unwrap_err(), PENDING);
        assert_eq!(
            reader
                .read(id, &cancel, || Ok(Some("new".into())))
                .await
                .unwrap()
                .as_deref(),
            Some("new")
        );
    }
    #[tokio::test]
    async fn cache_is_role_address_scoped_expiring_and_cancel_is_prompt() {
        let reader = CredentialReader::new(Duration::from_millis(30), Duration::from_millis(200));
        let cancel = AtomicBool::new(false);
        let a = Identity::new("chat", "https://a.invalid/v1", false);
        assert_eq!(
            reader
                .read(a.clone(), &cancel, || Ok(Some("a".into())))
                .await
                .unwrap()
                .as_deref(),
            Some("a")
        );
        let b = Identity::new("embedding", "https://a.invalid/v1", false);
        assert_eq!(
            reader
                .read(b, &cancel, || Ok(Some("b".into())))
                .await
                .unwrap()
                .as_deref(),
            Some("b")
        );
        tokio::time::sleep(Duration::from_millis(40)).await;
        assert_eq!(
            reader.read(a.clone(), &cancel, || Ok(None)).await.unwrap(),
            None
        );
        reader.invalidate();
        let work = reader.read(a, &cancel, || {
            std::thread::sleep(Duration::from_millis(100));
            Ok(None)
        });
        let stop = async {
            tokio::time::sleep(Duration::from_millis(5)).await;
            cancel.store(true, Ordering::SeqCst);
        };
        let (result, _) = tokio::join!(work, stop);
        assert_eq!(result.unwrap_err(), "操作已取消");
        assert!(reader.pending());
    }
}
