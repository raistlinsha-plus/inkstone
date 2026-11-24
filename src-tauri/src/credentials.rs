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
    #[cfg(test)]
    fn pending(&self) -> bool {
        self.state
            .lock()
            .map(|s| s.flight.is_some())
            .unwrap_or(true)
    }
    #[cfg(test)]
    async fn read<F>(&self, identity: Identity, cancel: &AtomicBool, reader: F) -> ResultValue
    where
        F: FnOnce() -> ResultValue + Send + 'static,
    {
        self.read_until(identity, cancel, reader, None).await
    }

    pub async fn read_for_import<F>(
        &self,
        identity: Identity,
        cancel: &AtomicBool,
        reader: F,
    ) -> ResultValue
    where
        F: FnOnce() -> ResultValue + Send + 'static,
    {
        self.read_until(
            identity,
            cancel,
            reader,
            Some(Instant::now() + Duration::from_secs(120)),
        )
        .await
    }

    /// A credential import can await the user's prompt, even if a previous caller
    /// already stopped waiting. Use one deadline across every occupied OS slot.
    async fn read_until<F>(
        &self,
        identity: Identity,
        cancel: &AtomicBool,
        reader: F,
        import_deadline: Option<Instant>,
    ) -> ResultValue
    where
        F: FnOnce() -> ResultValue + Send + 'static,
    {
        let epoch = self.state.lock().map_err(|_| "凭据读取状态不可用")?.epoch;
        let mut reader = Some(reader);
        loop {
            let (flight, launch) = {
                let mut state = self.state.lock().map_err(|_| "凭据读取状态不可用")?;
                if cancel.load(Ordering::SeqCst) {
                    return Err("操作已取消".into());
                }
                if state.epoch != epoch {
                    return Err("凭据配置已变化，请重新操作。".into());
                }
                let now = Instant::now();
                if import_deadline.is_some_and(|deadline| now >= deadline) {
                    return Err(PENDING.into());
                }
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
                    if import_deadline.is_none()
                        && (flight.identity != identity
                            || flight.epoch != epoch
                            || flight.started.elapsed() >= self.wait)
                    {
                        return Err(PENDING.into());
                    }
                    (flight.clone(), false)
                } else {
                    let (result, _) = watch::channel(None);
                    let flight = Arc::new(Flight {
                        identity: identity.clone(),
                        epoch,
                        started: now,
                        result,
                    });
                    state.flight = Some(flight.clone());
                    (flight, true)
                }
            };
            if launch {
                self.start_read(
                    flight.clone(),
                    reader.take().expect("one native read per caller"),
                );
            }
            let deadline = import_deadline.unwrap_or(flight.started + self.wait);
            let mut receiver = flight.result.subscribe();
            let completion = receiver.wait_for(Option::is_some);
            let published = tokio::select! {
                result = tokio::time::timeout(deadline.saturating_duration_since(Instant::now()), completion) =>
                    result.map_err(|_| PENDING.to_string())?.map_err(|_| "凭据读取中断".to_string())?,
                error = async {
                    loop {
                        if cancel.load(Ordering::SeqCst) {
                            return "操作已取消";
                        }
                        if !self.state.lock().is_ok_and(|state| state.epoch == epoch) {
                            return "凭据配置已变化，请重新操作。";
                        }
                        tokio::time::sleep(Duration::from_millis(20)).await;
                    }
                } => return Err(error.into()),
            };
            if cancel.load(Ordering::SeqCst) {
                return Err("操作已取消".into());
            }
            if flight.identity == identity && flight.epoch == epoch {
                if self.state.lock().map_err(|_| "凭据读取状态不可用")?.epoch != epoch {
                    return Err("凭据配置已变化，请重新操作。".into());
                }
                return published
                    .as_ref()
                    .expect("completed read has a result")
                    .clone();
            }
            // Another identity completed. Discard its result and obtain this
            // caller's credential under the same cancellation and epoch guards.
        }
    }

    fn start_read<F>(&self, current: Arc<Flight>, reader: F)
    where
        F: FnOnce() -> ResultValue + Send + 'static,
    {
        let shared = self.state.clone();
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
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    #[tokio::test]
    async fn simultaneous_same_identity_reads_share_one_result_and_failures_cool_down() {
        // This case checks identity/coalescing, not the deadline. Barriers control
        // ordering; the generous deadline allows a slow CI worker to be scheduled.
        let reader = CredentialReader::new(Duration::from_secs(60), Duration::from_secs(60));
        let id = Identity::new("chat", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let (release, resumed) = std::sync::mpsc::channel();
        let first = reader.read(id.clone(), &cancel, move || {
            resumed.recv().expect("release joined read");
            Ok(Some("same".into()))
        });
        let second = reader.read(id.clone(), &cancel, || panic!("must join"));
        let (a, b, _) = tokio::join!(biased; first, second, async {
            release.send(()).unwrap();
        });
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
        let reader = CredentialReader::new(Duration::from_secs(60), Duration::from_millis(40));
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let (release, resumed) = std::sync::mpsc::channel();
        let id = Identity::new("chat", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let error = reader
            .read(id.clone(), &cancel, move || {
                c.fetch_add(1, Ordering::SeqCst);
                // The native call stays blocked until the timeout/slot assertions finish.
                resumed
                    .recv()
                    .expect("test releases the simulated native read");
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
        let mut completion = reader
            .state
            .lock()
            .unwrap()
            .flight
            .as_ref()
            .unwrap()
            .result
            .subscribe();
        release.send(()).unwrap();
        // Await publication rather than assuming a blocking worker ran during a sleep.
        tokio::time::timeout(
            Duration::from_secs(10),
            completion.wait_for(|value| value.is_some()),
        )
        .await
        .expect("native result publication")
        .expect("result sender remains alive");
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
        let reader = CredentialReader::new(Duration::from_secs(60), Duration::from_secs(60));
        let id = Identity::new("chat", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let (release, resumed) = std::sync::mpsc::channel();
        let first = reader.read(id.clone(), &cancel, move || {
            resumed.recv().expect("release invalidated read");
            Ok(Some("old".into()))
        });
        let second = async {
            reader.invalidate();
            let result = reader
                .read(id.clone(), &cancel, || panic!("old read owns slot"))
                .await;
            release.send(()).unwrap();
            result
        };
        let (a, b) = tokio::join!(biased; first, second);
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
    async fn import_waits_for_an_existing_prompt_and_other_roles_get_their_own_key() {
        let reader = CredentialReader::new(Duration::from_secs(60), Duration::from_millis(10));
        let chat = Identity::new("chat", "https://a.invalid/v1", false);
        let embed = Identity::new("embedding", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let (release, wait) = std::sync::mpsc::channel();
        let pending = reader
            .read(chat.clone(), &cancel, move || {
                wait.recv_timeout(Duration::from_secs(10)).unwrap();
                Ok(Some("chat-key".into()))
            })
            .await;
        assert_eq!(pending.unwrap_err(), PENDING);

        let same = reader.read_for_import(chat, &cancel, || panic!("join the existing chat read"));
        let other =
            reader.read_for_import(embed.clone(), &cancel, || Ok(Some("embedding-key".into())));
        let (chat_result, embedding_result, _) = tokio::join!(biased; same, other, async {
            release.send(()).unwrap();
        });
        assert_eq!(chat_result.unwrap().as_deref(), Some("chat-key"));
        assert_eq!(embedding_result.unwrap().as_deref(), Some("embedding-key"));
        assert_eq!(
            reader
                .read_for_import(embed, &cancel, || panic!("reuse recent key"))
                .await
                .unwrap()
                .as_deref(),
            Some("embedding-key")
        );
    }

    #[tokio::test]
    async fn waiting_for_another_role_honors_budget_cancel_and_configuration_changes() {
        let reader = CredentialReader::new(Duration::from_secs(60), Duration::from_millis(10));
        let chat = Identity::new("chat", "https://a.invalid/v1", false);
        let embed = Identity::new("embedding", "https://a.invalid/v1", false);
        let cancel = AtomicBool::new(false);
        let (release, wait) = std::sync::mpsc::channel();
        let pending = reader
            .read(chat.clone(), &cancel, move || {
                wait.recv_timeout(Duration::from_secs(10)).unwrap();
                Ok(Some("old".into()))
            })
            .await;
        assert_eq!(pending.unwrap_err(), PENDING);

        let budget = Instant::now() + Duration::from_millis(25);
        let result = reader
            .read_until(embed.clone(), &cancel, || panic!("occupied"), Some(budget))
            .await;
        assert_eq!(result.unwrap_err(), PENDING);
        let stop = AtomicBool::new(false);
        let waiting = reader.read_for_import(embed.clone(), &stop, || panic!("cancelled"));
        let (result, _) =
            tokio::join!(biased; waiting, async { stop.store(true, Ordering::SeqCst) });
        assert_eq!(result.unwrap_err(), "操作已取消");

        let waiting = reader.read_for_import(embed, &cancel, || panic!("configuration changed"));
        let (result, _) = tokio::join!(biased; waiting, async { reader.invalidate() });
        assert!(result.unwrap_err().contains("配置已变化"));
        // A new request waits out the stale OS operation, then reads the new key.
        let fresh = reader.read_for_import(chat, &cancel, || Ok(Some("new".into())));
        let (result, _) = tokio::join!(biased; fresh, async { release.send(()).unwrap() });
        assert_eq!(result.unwrap().as_deref(), Some("new"));
    }

    #[tokio::test]
    async fn cache_is_role_address_scoped_expiring_and_cancel_is_prompt() {
        let reader = CredentialReader::new(Duration::from_millis(30), Duration::from_secs(60));
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
        let (release, resumed) = std::sync::mpsc::channel();
        let work = reader.read(a, &cancel, move || {
            resumed.recv().expect("release cancelled read");
            Ok(None)
        });
        let stop = async {
            cancel.store(true, Ordering::SeqCst);
        };
        let (result, _) = tokio::join!(biased; work, stop);
        assert_eq!(result.unwrap_err(), "操作已取消");
        assert!(reader.pending());
        let mut completion = reader
            .state
            .lock()
            .unwrap()
            .flight
            .as_ref()
            .unwrap()
            .result
            .subscribe();
        release.send(()).unwrap();
        tokio::time::timeout(
            Duration::from_secs(10),
            completion.wait_for(|value| value.is_some()),
        )
        .await
        .expect("cancelled reader completes after release")
        .expect("result sender remains alive");
    }
}
