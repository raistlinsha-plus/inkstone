# RC4 单篇文稿问答配对评测

评卷工作由独立 AI 编写新资料、题面、预期要点和干扰项，先冻结文件，再运行产品。两个版本使用同一份题卷。公开交付后题目可供回归，新一轮独立盲测需要另出题卷。在本轮开发过程中，产品实现者只接收匿名汇总。资料均为合成文本。

20 道主问题各运行两次。完整文稿包含问题所需的两个事实；13 个缺项变体保留其中一个事实，7 个全部缺失。每次都只选择一篇文稿，同空间另有一份载有准确答案的备份，检索和回答均须守住所选文稿范围。20 对中的 5 对是承接同一会话上一轮的真实追问，所以每版本共运行 40 个配对目标和 10 个铺垫轮。题卷包括主体名称近似、错误日期/时段/版本、条件变化、否定规定和已撤回提案。文稿都较短，一般能进入一个索引块；此集主要测证据判断和文稿内条件辨别，未覆盖长文档检索压力。

`packet.json` 仅含文稿、会话和范围。执行器编译嵌入题卷，逐轮使用合成临时工作区。冻结的 `labels.json` 仅由事后计分脚本读取，题卷哈希、标签哈希与评分约定哈希见 `SHA256SUMS`。临时工作区的随机路径与真实服务配置不进入仓库内的聚合结果。

```sh
(cd evals/v1.0/rc4 && shasum -a 256 -c SHA256SUMS)
run_dir="$(mktemp -d)"
INKSTONE_RC4_OFFLINE_REPORT="$run_dir/offline.json" \
  cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::rc4::offline_frozen_packet -- --exact
python3 evals/v1.0/rc4/report.py summary "$run_dir/offline.json"
```

离线断言覆盖全部 50 轮、10 轮会话历史、文稿范围、原始候选和零 HTTP 尝试。查询、候选、准入和最终上下文走产品的真实本地索引与读证据代码。生成阶段未执行。按原文完整句、文稿版本和行号判定每项直接支持。聚合中的 top8 为 BM25 原始前八，admitted 为搜索阶段带 evidence 标记的候选，selectedQuotes 为进入最终来源的读证据选句，sources 为整个最终上下文。保留来源不等于回答正确。离线追问拿到的先前输出可能是空答案或本地澄清；在线评测实际保存每一轮回答，再执行下一轮。

在仓库根目录重放 RC3 对照。脚本把固定的历史代码导出到临时目录，仅在测试模块接入这份题卷和候选快照采集，复用编译目录。在运行前按项目开发说明准备 Rust、离线依赖和前端 dist。

```sh
python3 evals/v1.0/rc4/rc3_replay.py "$run_dir/rc3-offline.json"
python3 evals/v1.0/rc4/report.py summary "$run_dir/rc3-offline.json"
```

真实作答需保存可用的问答端点及其绑定凭据。下面的命令显式开启合成评测试验中的候选阅读。每版本最多 120 次 HTTP 尝试，时限 1500 秒，可走同一进程的批处理复用凭据。运行后以实际报告中的请求次数和耗时汇总。

```sh
INKSTONE_RC4_LIVE=1 INKSTONE_EVAL_KEYCHAIN_WAIT_SECONDS=300 \
  INKSTONE_RC4_REPORT="$run_dir/live.json" \
  cargo test --offline --manifest-path src-tauri/Cargo.toml --lib \
  evaluation_v086::rc4::live_frozen_packet -- --exact --ignored --nocapture
```

在拟比较的全部在线报告齐备后，将它们一次打乱并掩去版本、条件、内部题号。将匿名阅卷文件与 `RUBRIC.md` 交给独立阅卷者。阅卷者只需填充每条 `judgment`，保留其余字段。映射只由计分端持有。阅卷工具按原始报告和题卷重新核对输入，拒绝篡改、缺卷、重复卷和未填写的判断。逐版本运行 grade，传入对应版本的离线报告以核对检索条件。成绩会区分答案正确、断言支持、缺项留白、整题误拒与成对通过；按需单列两变体、追问和铺垫轮。实际的人类盲评须单独开展。

```sh
python3 evals/v1.0/rc4/report.py blind "$run_dir/review" "$run_dir/rc3-live.json" "$run_dir/live.json"
python3 evals/v1.0/rc4/report.py grade "$run_dir/live.json" \
  "$run_dir/review/review.json" "$run_dir/review/private-key.json" \
  --reviewer-kind ai --offline "$run_dir/offline.json"
```

候选条件分母是检索问句、选中文稿范围与用户历史问题均匹配的离线重放所含直接支持点。实时阶段发生的回答或追问解析变化会使离线检索条件与在线不一致，计分脚本逐题排除并报告匹配数量。在线核对以实际返回的来源、回答及其就近引用为准。
