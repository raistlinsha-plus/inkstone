use crate::{db, files, models::*, providers, retrieval};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::atomic::AtomicBool};

#[derive(Deserialize, Serialize, Clone)]
struct Corpus {
    documents: Vec<Document>,
    cases: Vec<Case>,
}
#[derive(Deserialize, Serialize, Clone)]
struct Document {
    path: String,
    text: String,
}
#[derive(Deserialize, Serialize, Clone)]
struct Case {
    question: String,
    expected: Option<String>,
    kind: String,
    #[serde(default)]
    answerable: Option<bool>,
}

fn write_answer_report(name: &str, report: &serde_json::Value) {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("artifacts/v0.6-development");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(name), serde_json::to_vec_pretty(report).unwrap()).unwrap();
}
fn manual_review() -> serde_json::Value {
    serde_json::json!({"factualSupport":null,"citationSupport":null,"correctRefusal":null,"labelsPeriodsUnitsCorrect":null,"notes":null})
}
#[test]
fn answer_review_fixture_and_unrun_template_are_explicit() {
    let raw = include_str!("../../evals/v0.6/answer-review.json");
    let corpus = parse_external_corpus(raw).unwrap();
    let value: serde_json::Value = serde_json::from_str(raw).unwrap();
    assert_eq!(corpus.cases.len(), 12);
    assert!(value["cases"]
        .as_array()
        .unwrap()
        .iter()
        .all(|case| case["rubric"].as_str().is_some_and(|s| !s.is_empty())));
    let (_d, ws, conn, _) = setup(&corpus);
    let mut records = Vec::new();
    for (index, case) in corpus.cases.iter().enumerate() {
        let query = retrieval::knowledge_query(&case.question);
        let lexical = db::lexical_scored(&conn, &query, None).unwrap();
        let mut candidates = db::merge_candidates(&conn, &ws, &lexical, &[]).unwrap();
        retrieval::mark_lexical_evidence(&query, &mut candidates);
        records.push(serde_json::json!({"question":case.question,"retrievalQuestion":query,"expected":case.expected,"answerable":case.answerable,"rubric":value["cases"][index]["rubric"],"candidateCount":candidates.len(),"eligibleEvidenceCount":candidates.iter().filter(|r|r.evidence).count(),"answerGeneration":"not_run","answer":null,"manualReview":manual_review()}));
    }
    write_answer_report(
        "answer-review-template.json",
        &serde_json::json!({"scope":"Synthetic answer-review checklist and actual local BM25 preparation; no generation or answer-quality result.","answerGenerationRun":false,"heldOut":false,"credentialsRead":false,"records":records}),
    );
}

/// Opt-in only; no Keychain access and no scan of the user's document library.
#[tokio::test]
#[ignore = "Explicit answer corpus, endpoint and model required; generates real answers and incurs API usage."]
async fn remote_answer_review() -> Result<(), String> {
    use std::io::Read;
    let path = std::env::var("INKSTONE_ANSWER_EVAL_CORPUS")
        .map_err(|_| "请显式指定答案评测语料绝对路径")?;
    if !std::path::Path::new(&path).is_absolute() {
        return Err("答案评测语料必须使用绝对路径".into());
    }
    let mut raw = String::new();
    std::fs::File::open(path)
        .map_err(|_| "无法读取答案评测语料")?
        .take(2 * 1024 * 1024 + 1)
        .read_to_string(&mut raw)
        .map_err(|_| "答案评测语料不是UTF8")?;
    if raw.len() > 2 * 1024 * 1024 {
        return Err("答案评测语料超过2MB".into());
    }
    let corpus = parse_external_corpus(&raw)?;
    if corpus.cases.len() > 32 {
        return Err("每轮答案评测最多32题，请显式拆分以控制用量".into());
    }
    let labels: serde_json::Value = serde_json::from_str(&raw).map_err(|_| "答案评测标注无效")?;
    let provider = Provider {
        enabled: true,
        base_url: std::env::var("INKSTONE_ANSWER_EVAL_BASE_URL").map_err(|_| "缺少答案评测端点")?,
        model: std::env::var("INKSTONE_ANSWER_EVAL_MODEL").map_err(|_| "缺少答案评测模型")?,
        ..Default::default()
    };
    providers::validate(&provider)?;
    let key = std::env::var("INKSTONE_ANSWER_EVAL_API_KEY").ok();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|_| "无法创建答案评测客户端")?;
    let (_d, ws, conn, _) = setup(&corpus);
    let cancel = AtomicBool::new(false);
    let mut records = Vec::new();
    let mut calls = 0;
    for (index, case) in corpus.cases.iter().enumerate() {
        let query = retrieval::knowledge_query(&case.question);
        let hits = db::lexical_scored(&conn, &query, None)?;
        let mut candidates = db::merge_candidates(&conn, &ws, &hits, &[])?;
        retrieval::mark_lexical_evidence(&query, &mut candidates);
        let sources = retrieval::answer_context(&ws, &candidates, 2400, false);
        let start = std::time::Instant::now();
        let (answer, finish, error) = if sources.is_empty() {
            (
                "当前资料中没有足够直接证据。".into(),
                "no_evidence".into(),
                None,
            )
        } else {
            calls += 1;
            match providers::chat(
                &client,
                &provider,
                key.as_deref(),
                &case.question,
                &sources,
                &cancel,
                None,
                &format!("answer-eval-{index}"),
            )
            .await
            {
                Ok(output) => (output.text, output.finish_reason, None),
                Err(_) => (String::new(), "error".into(), Some("provider_error")),
            }
        };
        let chart = crate::answer_validation::audit_charts(&answer, &sources);
        records.push(serde_json::json!({"question":case.question,"retrievalQuestion":query,"expected":case.expected,"answerable":case.answerable,"rubric":labels["cases"][index]["rubric"],"modelCalled":!sources.is_empty(),"sources":sources,"answer":answer,"finishReason":finish,"errorKind":error,"elapsedMs":start.elapsed().as_millis(),"rejectedChartCount":chart.rejected.len(),"chartWarnings":chart.warnings,"manualReview":manual_review()}));
        write_answer_report(
            "answer-review-remote.json",
            &serde_json::json!({"scope":"Explicit synthetic corpus; real generation with local BM25 retrieval only. Manual review required; not a held-out benchmark or calibrated refusal accuracy.","answerGenerationRun":true,"completedCases":records.len(),"caseCount":corpus.cases.len(),"corpusHash":files::hash(raw.as_bytes()),"model":provider.model,"modelCallCount":calls,"keychainAccessed":false,"providerBilledCost":null,"records":records}),
        );
    }
    Ok(())
}

fn corpus() -> Corpus {
    let mut c: Corpus = serde_json::from_str(include_str!("../../evals/rag-cases.json")).unwrap();
    let extra = [
        ("编辑.md", "Markdown 原文是在哪个源码组件里编辑的？"),
        ("编辑.md", "CodeMirror 和 Milkdown 分别承担什么编辑工作？"),
        ("编辑.md", "文档结构由 remark 解析吗？"),
        ("编辑.md", "分栏能同时查看代码和排版吗？"),
        ("编辑.md", "纯 Markdown 能在可视化界面编写吗？"),
        ("编辑.md", "怎样同时看原文和排版预览？"),
        ("存储.md", "保存正文是否采用原子写入？"),
        ("存储.md", "原文件被移走后是否仍保留恢复草稿？"),
        ("存储.md", "本地数据库故障时应该继续保存正文吗？"),
        ("存储.md", "恢复草稿与原始文件在同一个目录吗？"),
        ("存储.md", "保存故障是否应该造成正文丢失？"),
        ("存储.md", "草稿的应用数据目录用途是什么？"),
        (
            "JSON.md",
            "大整数 9007199254740993 会被结构编辑改写精度吗？",
        ),
        ("JSON.md", "重复键为什么会关闭 JSON 树写入？"),
        ("JSON.md", "JSON 字段用什么路径表示？"),
        ("JSON.md", "怎样对 JSON 对象属性增删？"),
        ("JSON.md", "JSON 校验和格式化是否都支持？"),
        ("JSON.md", "结构编辑可否保留数字字面量？"),
        ("JSON.md", "对象属性操作在字段树里完成吗？"),
        ("图表.md", "时序图的 Mermaid 类型名称是什么？"),
        ("图表.md", "流程图是否使用 flowchart？"),
        ("图表.md", "stateDiagram-v2 表示哪类图表？"),
        ("图表.md", "classDiagram 类图能导出为 SVG 吗？"),
        ("图表.md", "图形预览在本地隔离区域执行吗？"),
        ("图表.md", "Mermaid 支持哪些已经列出的图形类别？"),
        ("图表.md", "图表导出的格式是 SVG 吗？"),
        ("脑图.md", "Markmap 根据 Markdown 的标题和列表生成脑图吗？"),
        ("脑图.md", "简单脑图节点可以新增子节点吗？"),
        ("脑图.md", "删除脑图节点会删除整个子树吗？"),
        ("脑图.md", "复杂正文分支在脑图里能回写吗？"),
        ("脑图.md", "只读脑图分支能否定位原文？"),
        ("脑图.md", "脑图能修改节点名称吗？"),
        ("检索.md", "RRF 在本地检索中承担什么作用？"),
        ("检索.md", "中文全文检索采用哪个分词库？"),
        ("检索.md", "sqlite-vec 用于文本向量还是中文分词？"),
        ("检索.md", "SQLite FTS5 负责全文检索吗？"),
        ("检索.md", "索引返回结果前会核对文档哈希吗？"),
        ("检索.md", "关键词与向量结果如何合并排名？"),
        ("服务.md", "向量模型 text-embedding-3-small 对应多少维？"),
        ("服务.md", "问答与向量化服务可以分别配置吗？"),
        ("服务.md", "API 服务采用什么兼容协议？"),
        ("服务.md", "gpt-4.1-mini 能否使用流式回答？"),
        ("服务.md", "用户可以使用自己的 API 模型吗？"),
        ("服务.md", "1536 维向量来自哪个模型？"),
        ("隐私.md", "API Key 是否保存在 Keychain？"),
        ("隐私.md", "远程问答会发送哪些资料？"),
        ("隐私.md", "远程向量化会发送文本切片吗？"),
        ("隐私.md", "正文和索引是留在本机的吗？"),
        ("隐私.md", "独立 JSON 是否默认避免自动建库？"),
        ("隐私.md", "问题和命中片段会传给远程问答吗？"),
        ("平台.md", "界面采用 React 和 TypeScript 吗？"),
        ("平台.md", "当前验收机器内存是多少？"),
        ("平台.md", "平台是否已经承诺云同步或 OCR？"),
        ("平台.md", "当前验收针对 Apple Silicon 还是其他平台？"),
        ("平台.md", "桌面框架是否是 Tauri 2？"),
        ("平台.md", "Rust 在桌面技术栈中使用吗？"),
        ("许可.md", "新增组件是否优先采用 MIT？"),
        ("许可.md", "依赖中的 MPL-2.0 需要保留许可声明吗？"),
        ("许可.md", "项目自身使用 Apache-2.0 吗？"),
        ("许可.md", "可以把全部第三方依赖都宣称为 MIT 吗？"),
        ("许可.md", "第三方许可声明为什么不能省略？"),
        ("注入样例.md", "文档要求忽略系统规则能否视为授权？"),
        ("注入样例.md", "读取资料是否允许泄露 API 密钥？"),
        ("注入样例.md", "文档中的上传整个文件夹指令可信任吗？"),
        ("注入样例.md", "提示注入样例是否授权删除本地资料？"),
        ("注入样例.md", "资料能否要求假装全部测试通过？"),
        ("", "珠穆朗玛峰的当前积雪厚度是多少？"),
        ("", "香蕉种植的最佳海拔是多少？"),
        ("", "木星卫星欧罗巴冰壳有多厚？"),
        ("", "今晚附近有哪些餐厅还在营业？"),
    ];
    for (path, question) in extra {
        c.cases.push(Case {
            question: question.into(),
            expected: if path.is_empty() {
                None
            } else {
                Some(path.into())
            },
            kind: if path.is_empty() {
                "unanswerable"
            } else if path == "注入样例.md" {
                "injection"
            } else {
                "answerable"
            }
            .into(),
            answerable: None,
        });
    }
    assert_eq!(c.cases.len(), 100);
    c
}
fn parse_external_corpus(raw: &str) -> Result<Corpus, String> {
    if raw.len() > 8 * 1024 * 1024 {
        return Err("评测语料超过 8MB".into());
    }
    let corpus: Corpus = serde_json::from_str(raw).map_err(|_| "评测语料JSON格式无效")?;
    if corpus.documents.is_empty()
        || corpus.documents.len() > 200
        || corpus.cases.is_empty()
        || corpus.cases.len() > 1000
    {
        return Err("评测语料需有 1–200 篇文档和 1–1000 个问题".into());
    }
    let mut paths = std::collections::HashSet::new();
    for doc in &corpus.documents {
        files::validate_relative(&doc.path)?;
        if !files::supported(std::path::Path::new(&doc.path))
            || doc.text.len() > files::MAX_FILE as usize
            || doc.text.trim().is_empty()
            || !paths.insert(doc.path.clone())
        {
            return Err("评测文档路径重复、内容为空、类型或长度无效".into());
        }
    }
    for case in &corpus.cases {
        if case.question.trim().is_empty()
            || case.question.chars().count() > 1500
            || case.expected.as_ref().is_some_and(|p| !paths.contains(p))
        {
            return Err("评测问题为空、过长或标注了不存在的来源".into());
        }
    }
    Ok(corpus)
}
fn setup(
    corpus: &Corpus,
) -> (
    tempfile::TempDir,
    Workspace,
    rusqlite::Connection,
    HashMap<i64, usize>,
) {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().canonicalize().unwrap();
    let ws = Workspace {
        db: root.join("index.sqlite3"),
        root,
    };
    let mut conn = db::open(&ws.db).unwrap();
    let mut chunks = HashMap::new();
    for (topic, doc) in corpus.documents.iter().enumerate() {
        std::fs::create_dir_all(ws.root.join(&doc.path).parent().unwrap()).unwrap();
        std::fs::write(ws.root.join(&doc.path), &doc.text).unwrap();
        let content = db::local_chunks(&doc.text, &doc.path, 1200);
        let ids = db::refresh_lexical(
            &mut conn,
            &doc.path,
            &files::hash(&doc.text),
            &content,
            &doc.path,
        )
        .unwrap();
        for id in ids {
            chunks.insert(id, topic);
        }
    }
    (d, ws, conn, chunks)
}
fn ranked_metrics(results: &[SearchResult], case: &Case) -> serde_json::Value {
    let mut paths = vec![];
    for r in results {
        if !paths.contains(&r.path) {
            paths.push(r.path.clone());
        }
    }
    let rank = case
        .expected
        .as_ref()
        .and_then(|path| paths.iter().position(|p| p == path))
        .map(|i| i + 1);
    serde_json::json!({"recallAt20":rank.is_some_and(|r|r<=20),"reciprocalRankAt10":rank.filter(|r|*r<=10).map(|r|1.0/r as f64).unwrap_or(0.0),"ndcgAt10":rank.filter(|r|*r<=10).map(|r|1.0/(r as f64+1.0).log2()).unwrap_or(0.0),"evidenceFalsePositive":case.expected.is_none()&&results.iter().any(|r|r.evidence),"top10":paths.into_iter().take(10).collect::<Vec<_>>()})
}
fn summarize(records: &[serde_json::Value], mode: &str) -> serde_json::Value {
    let answerable = records
        .iter()
        .filter(|r| !r["expected"].is_null())
        .collect::<Vec<_>>();
    let negative = records
        .iter()
        .filter(|r| r["expected"].is_null())
        .collect::<Vec<_>>();
    let count = answerable.len().max(1) as f64;
    let mean = |key: &str| {
        answerable
            .iter()
            .map(|r| r[mode][key].as_f64().unwrap_or(0.0))
            .sum::<f64>()
            / count
    };
    serde_json::json!({"questions":records.len(),"relevantDocumentCases":answerable.len(),"noRelevantDocumentCases":negative.len(),"answerableOrInjection":answerable.len(),"unanswerable":negative.len(),"recallAt20":answerable.iter().filter(|r|r[mode]["recallAt20"]==true).count()as f64/count,"mrrAt10":mean("reciprocalRankAt10"),"ndcgAt10":mean("ndcgAt10"),"evidenceFalsePositives":negative.iter().filter(|r|r[mode]["evidenceFalsePositive"]==true).count()})
}
fn write_report(name: &str, value: &serde_json::Value) {
    let folder = if name.starts_with("v0.5-") || std::env::var_os("INKSTONE_EVAL_CORPUS").is_some()
    {
        "../artifacts/v0.5-development"
    } else {
        "../artifacts/v0.4-development"
    };
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(folder);
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(name), serde_json::to_vec_pretty(value).unwrap()).unwrap();
}

#[test]
fn natural_chinese_keyword_baseline_and_external_corpus_guards() {
    let corpus =
        parse_external_corpus(include_str!("../../evals/v0.5/natural-chinese.json")).unwrap();
    assert_eq!(corpus.documents.len(), 30);
    assert_eq!(corpus.cases.len(), 100);
    assert_eq!(
        corpus
            .cases
            .iter()
            .filter(|c| c.answerable == Some(false))
            .count(),
        10
    );
    for path in ["../escape.md", "/tmp/escape.md", "duplicate.md"] {
        let docs = if path == "duplicate.md" {
            serde_json::json!([{"path":path,"text":"a"},{"path":path,"text":"b"}])
        } else {
            serde_json::json!([{"path":path,"text":"a"}])
        };
        assert!(parse_external_corpus(&serde_json::json!({"documents":docs,"cases":[{"question":"test","kind":"lookup","expected":null}]}).to_string()).is_err());
    }
    let (_dir, ws, conn, _) = setup(&corpus);
    let mut records = vec![];
    for case in &corpus.cases {
        let lexical = db::lexical_scored(&conn, &case.question, None).unwrap();
        let mut results = db::merge_candidates(&conn, &ws, &lexical, &[]).unwrap();
        retrieval::mark_lexical_evidence(&case.question, &mut results);
        records.push(serde_json::json!({"question":case.question,"expected":case.expected,"answerable":case.answerable,"kind":case.kind,"bm25":ranked_metrics(&results,case),"answerQuality":null,"citationSupport":null,"correctRefusal":null}));
    }
    let summaries = serde_json::json!({"bm25":summarize(&records,"bm25")});
    write_report(
        "v0.5-natural-chinese-bm25.json",
        &serde_json::json!({"scope":"30 fictional natural Chinese task documents and 100 labeled questions. Real production local BM25 only; no embeddings, reranker or answer generation. Not held-out user-data evaluation.","corpusDocumentCount":30,"questionCount":100,"rankingUnit":"single labeled relevant document; insufficient-information questions may still have a relevant document","summaries":summaries,"records":records}),
    );
    assert!(summaries["bm25"]["recallAt20"].as_f64().unwrap() >= 0.6);
}
#[test]
fn hundred_question_four_stage_controlled_pipeline() {
    let corpus = corpus();
    let (_d, ws, mut conn, chunk_topics) = setup(&corpus);
    write_report(
        "retrieval-corpus-100.json",
        &serde_json::to_value(&corpus).unwrap(),
    );
    let dim = corpus.documents.len() + 1;
    let mut paths = HashMap::<String, Vec<i64>>::new();
    for (id, topic) in &chunk_topics {
        paths
            .entry(corpus.documents[*topic].path.clone())
            .or_default()
            .push(*id);
    }
    for (path, ids) in &paths {
        let topic = corpus
            .documents
            .iter()
            .position(|d| &d.path == path)
            .unwrap();
        let mut prototype = vec![0.0; dim];
        prototype[topic] = 1.0;
        db::put_vectors(
            &mut conn,
            path,
            "controlled-fixture",
            &ids,
            &vec![prototype; ids.len()],
        )
        .unwrap();
    }
    let mut records = vec![];
    for case in &corpus.cases {
        let expected_topic = case
            .expected
            .as_ref()
            .and_then(|p| corpus.documents.iter().position(|d| &d.path == p))
            .unwrap_or(dim - 1);
        let mut query_vector = vec![0.0; dim];
        query_vector[expected_topic] = 1.0;
        let lexical = db::lexical_scored(&conn, &case.question, None).unwrap();
        let vectors = db::nearest_scored(&conn, &query_vector, None).unwrap();
        let mut keyword = db::merge_candidates(&conn, &ws, &lexical, &[]).unwrap();
        retrieval::mark_lexical_evidence(&case.question, &mut keyword);
        let mut vector = db::merge_candidates(&conn, &ws, &[], &vectors).unwrap();
        retrieval::mark_lexical_evidence(&case.question, &mut vector);
        let mut hybrid = db::merge_candidates(&conn, &ws, &lexical, &vectors).unwrap();
        retrieval::mark_lexical_evidence(&case.question, &mut hybrid);
        let mut reranked = hybrid.clone();
        let scores = reranked
            .iter()
            .enumerate()
            .map(|(i, r)| {
                (
                    i,
                    if case.expected.as_ref() == Some(&r.path) {
                        0.95
                    } else {
                        0.01
                    },
                )
            })
            .collect::<Vec<_>>();
        retrieval::apply_rerank(&mut reranked, &scores, 0.5);
        records.push(serde_json::json!({"question":case.question,"kind":case.kind,"expected":case.expected,"bm25":ranked_metrics(&keyword,case),"vectorFixture":ranked_metrics(&vector,case),"rrfFixture":ranked_metrics(&hybrid,case),"rerankFixture":ranked_metrics(&reranked,case),"answerQuality":null,"citationSupport":null,"correctRefusal":null}));
    }
    let summaries = ["bm25", "vectorFixture", "rrfFixture", "rerankFixture"]
        .iter()
        .map(|mode| (mode.to_string(), summarize(&records, mode)))
        .collect::<HashMap<_, _>>();
    write_report(
        "retrieval-controlled-100.json",
        &serde_json::json!({"scope":"100 labeled questions, local production keyword chunks; four-stage controlled protocol and ordering test, NOT model quality. One-hot vectors and rerank scores encode known labels by design.","rankingUnit":"unique document, deduplicated before rank cutoffs; expected marks one relevant document, answerability is tracked separately","labelIndependenceEstablished":false,"answerGenerationRun":false,"corpusDocumentCount":corpus.documents.len(),"rankingStage":"raw retrieval or rerank order before evidence-first UI ordering and 12-result display cap","evidenceGate":"uncalibrated keyword coverage >=2/3; this is not a relevance probability","realEmbeddingModel":null,"realReranker":null,"summaries":summaries,"records":records}),
    );
    assert!(records
        .iter()
        .filter(|r| r["expected"].is_null())
        .all(|r| r["rerankFixture"]["evidenceFalsePositive"] == false));
    assert!(records
        .iter()
        .filter(|r| !r["expected"].is_null())
        .all(|r| r["rrfFixture"]["recallAt20"] == true));
    assert!(summaries["bm25"]["recallAt20"].as_f64().unwrap() >= 0.8);
}

/// This opt-in test sends only the built-in corpus or an explicitly selected
/// JSON corpus. It does not scan the user's library. Credentials are not saved.
#[tokio::test]
#[ignore = "Explicit API endpoint/key environment variables required; may incur provider usage."]
async fn remote_hundred_question_retrieval() -> Result<(), String> {
    let external = std::env::var("INKSTONE_EVAL_CORPUS").ok();
    let corpus = match external.as_ref() {
        Some(path) => {
            use std::io::Read;
            let mut raw = String::new();
            std::fs::File::open(path)
                .map_err(|_| "无法读取显式指定的评测语料")?
                .take(8 * 1024 * 1024 + 1)
                .read_to_string(&mut raw)
                .map_err(|_| "评测语料不是UTF-8文本")?;
            parse_external_corpus(&raw)?
        }
        None => corpus(),
    };
    let (_d, ws, mut conn, _) = setup(&corpus);
    let base_url = std::env::var("INKSTONE_EVAL_BASE_URL").map_err(|_| "缺少显式评测服务地址")?;
    let key = std::env::var("INKSTONE_EVAL_API_KEY").ok();
    let provider = Provider {
        enabled: true,
        base_url,
        model: std::env::var("INKSTONE_EVAL_EMBEDDING_MODEL")
            .unwrap_or("text-embedding-3-small".into()),
        ..Default::default()
    };
    providers::validate(&provider)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|_| "无法建立评测客户端")?;
    let cancel = AtomicBool::new(false);
    let profile = providers::fingerprint(&provider);
    let reranker = std::env::var("INKSTONE_EVAL_RERANK_ENDPOINT")
        .ok()
        .filter(|s| !s.is_empty())
        .map(|endpoint| RerankProvider {
            enabled: true,
            endpoint,
            model: std::env::var("INKSTONE_EVAL_RERANK_MODEL").unwrap_or_default(),
            timeout_ms: 10000,
            ..Default::default()
        });
    if let Some(p) = &reranker {
        providers::validate_reranker(p)?;
    }
    let rerank_key = std::env::var("INKSTONE_EVAL_RERANK_KEY").ok();
    let chunks = conn
        .prepare("SELECT id,path,heading,text FROM chunks ORDER BY id")
        .map_err(|_| "无法读取评测切片")?
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| "无法读取评测切片")?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "无法读取评测切片")?;
    let inputs = chunks
        .iter()
        .map(|(_, _, heading, text)| format!("{heading}\n\n{text}"))
        .collect::<Vec<_>>();
    let start = std::time::Instant::now();
    let vectors = providers::embed(&client, &provider, key.as_deref(), &inputs, &cancel).await?;
    let mut groups = HashMap::<String, (Vec<i64>, Vec<Vec<f32>>)>::new();
    for ((id, path, _, _), vector) in chunks.into_iter().zip(vectors) {
        let entry = groups.entry(path).or_default();
        entry.0.push(id);
        entry.1.push(vector);
    }
    for (path, (ids, vectors)) in groups {
        db::put_vectors(&mut conn, &path, &profile, &ids, &vectors)?;
    }
    let questions = corpus
        .cases
        .iter()
        .map(|c| c.question.clone())
        .collect::<Vec<_>>();
    let query_vectors =
        providers::embed(&client, &provider, key.as_deref(), &questions, &cancel).await?;
    let embedding_batch_wall_ms = start.elapsed().as_millis();
    let mut records = vec![];
    let mut rerank_latencies = vec![];
    for (case, query_vector) in corpus.cases.iter().zip(query_vectors) {
        let lexical = db::lexical_scored(&conn, &case.question, None)?;
        let vector = db::nearest_scored(&conn, &query_vector, None)?;
        let mut keyword = db::merge_candidates(&conn, &ws, &lexical, &[])?;
        retrieval::mark_lexical_evidence(&case.question, &mut keyword);
        let mut vector_results = db::merge_candidates(&conn, &ws, &[], &vector)?;
        retrieval::mark_lexical_evidence(&case.question, &mut vector_results);
        let mut hybrid = db::merge_candidates(&conn, &ws, &lexical, &vector)?;
        retrieval::mark_lexical_evidence(&case.question, &mut hybrid);
        let reranked = if let Some(p) = &reranker {
            let start = std::time::Instant::now();
            let count = hybrid.len().min(p.candidate_count);
            let docs = hybrid[..count]
                .iter()
                .map(|r| {
                    format!(
                        "{}\n{}\n{}",
                        r.title.as_deref().unwrap_or(""),
                        r.heading,
                        r.text
                    )
                })
                .collect::<Vec<_>>();
            if docs.is_empty() {
                Some(vec![])
            } else {
                let ranking = providers::rerank(
                    &client,
                    p,
                    rerank_key.as_deref(),
                    &case.question,
                    &docs,
                    &cancel,
                )
                .await?;
                rerank_latencies.push(start.elapsed().as_millis() as u64);
                let mut result = hybrid.clone();
                retrieval::apply_rerank(&mut result, &ranking, p.min_score);
                Some(result)
            }
        } else {
            None
        };
        records.push(serde_json::json!({"question":case.question,"expected":case.expected,"kind":case.kind,"answerable":case.answerable.unwrap_or(case.expected.is_some()),"bm25":ranked_metrics(&keyword,case),"vector":ranked_metrics(&vector_results,case),"rrf":ranked_metrics(&hybrid,case),"rerank":reranked.map(|r|ranked_metrics(&r,case)),"answerQuality":null,"citationSupport":null,"correctRefusal":null}));
    }
    rerank_latencies.sort_unstable();
    let percentile = |p: f64| {
        if rerank_latencies.is_empty() {
            None
        } else {
            Some(
                rerank_latencies
                    [((rerank_latencies.len() as f64 * p).ceil() as usize).saturating_sub(1)],
            )
        }
    };
    let mut modes = vec!["bm25", "vector", "rrf"];
    if reranker.is_some() {
        modes.push("rerank");
    }
    let summaries = modes
        .into_iter()
        .map(|mode| (mode.to_string(), summarize(&records, mode)))
        .collect::<HashMap<_, _>>();
    write_report(
        "retrieval-remote-100.json",
        &serde_json::json!({"scope":"Configured real embedding API with a bundled synthetic or explicitly selected labeled corpus; retrieval only, not generated answers. Label independence and factual answer quality are not established.","corpusSource":if external.is_some(){"explicit-json"}else{"bundled-synthetic"},"corpusHash":files::hash(serde_json::to_vec(&corpus).unwrap()),"corpusCaseCount":corpus.cases.len(),"rankingUnit":"unique document, deduplicated before rank cutoffs; expected marks one relevant document, answerability is tracked separately","labelIndependenceEstablished":false,"answerGenerationRun":false,"corpusDocumentCount":corpus.documents.len(),"rankingStage":"raw retrieval or rerank order before evidence-first UI ordering and 12-result display cap","evidenceGate":"uncalibrated keyword coverage >=2/3 or user-configured rerank score threshold","embeddingModel":provider.model,"rerankerModel":reranker.map(|p|p.model),"rerankerStatus":if rerank_latencies.is_empty(){"not run"}else{"completed"},"embeddingInputCount":inputs.len()+questions.len(),"embeddingBatchWallMs":embedding_batch_wall_ms,"onlineQueryEmbeddingP50ms":null,"onlineQueryEmbeddingP95ms":null,"firstTokenP50ms":null,"firstTokenP95ms":null,"providerBilledCost":null,"rerankP50ms":percentile(0.5),"rerankP95ms":percentile(0.95),"summaries":summaries,"records":records}),
    );
    Ok(())
}
