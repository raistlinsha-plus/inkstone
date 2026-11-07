/* Fixed local scenarios, never an LLM or production conversation store. */
let demoStream = null;
function currentThread() {
  if (!state.threads?.length) state.threads = [{id:"thread-first",title:"新会话",scope:"space",documentId:null,messages:[]}];
  return state.threads.find(t=>t.id===state.threadId) || state.threads[0];
}
function newThread(scope = "space") {
  stopDemoStream();
  const t={id:"thread-"+Date.now()+"-"+(state.threads?.length||0),title:"新会话",scope,documentId:scope==="current"?state.activeDoc:null,messages:[]};
  state.threads ||= []; state.threads.unshift(t); state.threadId=t.id;
  state.answer="empty"; state.tab="ask"; renderKnowledge(); persist();
}
function scopeName(t=currentThread()) {
  return t.scope==="current" ? "当前文档 · "+(docs.find(d=>d.id===t.documentId)?.title || "来源已不可用") : "当前空间 · 砚间书房";
}
function renderChatHeader() {
  const t=currentThread();
  $("#chat-scope").value=t.scope;
  $("#chat-title").textContent=t.title;
  $("#chat-scope-label").textContent=scopeName(t);
  $("#ask-form>label").textContent=t.scope==="current"?"向本会话固定文档提问":"向当前空间提问";
  $("#ask-form .scope-pill").textContent=scopeName(t)+" · BM25 + 向量 · 重排序（演示）";
  document.body.classList.toggle("chat-expanded",!!state.chatExpanded);
  $("#expand-chat").textContent=state.chatExpanded?"返回编辑":"展开问答";
  $("#chat-scope").disabled=!!demoStream;
}
function fixedAnswer(message) {
  if(message.status==="stopped") return '<p class="answer-notice">生成已停止。未完成内容不作为有效回答，可重新生成。</p>';
  if(message.status==="streaming") return '<p role="status">演示：检索已完成，正在生成…</p><p>甲方案参与人数较多，已找到人数资料。</p><button data-action="stop-chat">停止生成</button>';
  if(message.kind==="insufficient") return '<h3>资料不足以判断满意度</h3><p>当前资料只记录时间和人数，没有满意度或反馈指标。人数较多不等于更受欢迎。</p><p>可补充：满意度问卷、有效样本数与调查口径。</p>';
  if(message.kind==="unsupported") return '<p>这不是本原型覆盖的合成问法。可试“比较两种阅读活动人数”或追问“哪个满意度更高”。此原型不调用通用模型。</p>';
  return '<h3>甲方案参与人数较多</h3><p>甲方案为 <strong>120 人</strong>，乙方案为 <strong>80 人</strong>，相差 <strong>40 人</strong>。<button class="source-tag" data-action="sources">S1</button></p><table class="answer-table"><thead><tr><th>方案</th><th>时间</th><th>人数</th></tr></thead><tbody><tr><td>甲</td><td>周二</td><td>120 人</td></tr><tr><td>乙</td><td>周四</td><td>80 人</td></tr></tbody></table><p>资料不足以判断满意度或方案优劣。</p>';
}
function renderThread() {
  const t=currentThread();
  return t.messages.map((m,index)=>'<section class="chat-turn"><div class="user-message"><span>你</span><p>'+esc(m.question)+'</p><button data-action="edit-question" data-id="'+m.id+'">修改问题</button></div><div class="answer" data-message="'+m.id+'"><span class="answer-label">知识回答 · 固定演示 · 第'+(index+1)+'轮</span>'+fixedAnswer(m)+
    (m.status==="complete"?'<div class="fact-source"><button class="source-tag" data-action="sources">资料依据 · S1 · 阅读活动方案.md</button><p>范围已固定 · '+esc(scopeName(t))+'<br>检索：BM25 + 向量 · 重排完成 · 新增角色化模型请求：0</p></div><div class="answer-actions"><button data-action="copy-answer" data-id="'+m.id+'">复制 MD</button><button data-action="save-answer" data-id="'+m.id+'">保存为文档</button><button data-action="insert-answer" data-id="'+m.id+'">插入正文</button><button data-action="regenerate" data-id="'+m.id+'">重新生成</button></div><p class="microcopy">候选 '+(m.variants||1)+' / '+(m.variants||1)+' · 生成不计成长</p>':'')+'</div></section>').join('') +
    '<div class="followup-chips"><button data-action="followup">追问：哪个满意度更高？</button><button data-action="demo-stream">体验生成与中止</button></div>';
}
function sendDemoQuestion(question, stream=false) {
  const t=currentThread();
  if(demoStream) return toast("请先停止或等待本轮演示完成。");
  const q=question.trim(); if(!q) return;
  const kind=/满意|更受欢迎|哪个更好/.test(q)?"insufficient":/人数|比较|相差|阅读活动/.test(q)?"comparison":"unsupported";
  const m={id:"message-"+Date.now()+"-"+t.messages.length,question:q,kind,status:stream?"streaming":"complete",variants:1};
  t.messages.push(m); if(t.messages.length===1)t.title=q.slice(0,16);
  state.answer="answer";state.tab="ask";$("#question").value="";
  if(stream) demoStream=setTimeout(()=>{m.status="complete";demoStream=null;renderKnowledge();renderCompanion();persist();},3500);
  renderKnowledge();renderCompanion();persist();
  $("#knowledge-body").scrollTop=$("#knowledge-body").scrollHeight;
}
function stopDemoStream() {
  if(demoStream) clearTimeout(demoStream);
  demoStream=null;
  for(const t of state.threads||[])for(const m of t.messages)if(m.status==="streaming")m.status="stopped";
}
function answerMarkdown(m) {
  return m.kind==="insufficient" ? '## 资料不足\n\n资料没有满意度指标，无法判断。\n\n来源：阅读活动方案.md（合成示例）' : '## 阅读活动比较\n\n|方案|时间|人数|\n|---|---|---|\n|甲|周二|120人|\n|乙|周四|80人|\n\n相差40人；资料不足以判断满意度。\n\n来源：阅读活动方案.md（合成示例）';
}
function chatAction(action,button) {
  const t=currentThread(),m=t.messages.find(x=>x.id===button.dataset.id);
  if(action==="new-chat"){newThread();return true;}
  if(action==="expand-chat"){state.chatExpanded=!state.chatExpanded;renderKnowledge();persist();return true;}
  if(action==="history"){
    setDialog("问答会话","仅本原型浏览器数据；不会读取真实Inkstone会话。",'<div class="thread-list">'+state.threads.map(x=>'<button data-action="open-thread" data-id="'+x.id+'"><strong>'+esc(x.title)+'</strong><small>'+esc(scopeName(x))+' · '+x.messages.length+'轮</small></button>').join('')+'</div>','<button data-action="close">返回</button>');return true;
  }
  if(action==="open-thread"){stopDemoStream();state.threadId=button.dataset.id;state.answer=currentThread().messages.length?"answer":"empty";closeDialog();renderKnowledge();persist();return true;}
  if(action==="followup"){sendDemoQuestion("这两种活动，哪个满意度更高？");return true;}
  if(action==="demo-stream"){sendDemoQuestion("比较两种阅读活动的参与人数",true);return true;}
  if(action==="stop-chat"){stopDemoStream();renderKnowledge();renderCompanion();persist();return true;}
  if(action==="edit-question"&&m){$("#question").value=m.question;$("#question").focus();toast("修改后发送为新一轮，原问题和回答保留。");return true;}
  if(action==="regenerate"&&m){m.variants=(m.variants||1)+1;m.status="complete";renderKnowledge();persist();toast("演示生成新候选；生产版保留完整旧候选和来源快照。");return true;}
  if(["copy-answer","save-answer","insert-answer"].includes(action)&&m){
    if(m.status!=="complete"||m.kind==="unsupported")return true;
    const md=answerMarkdown(m);
    if(action==="insert-answer"){
      setDialog("插入回答到演示正文","追加到当前演示笔记末尾；不会覆盖未保存内容。",'<pre class="markdown-preview">'+esc(md)+'</pre>','<button data-action="close">取消</button><button class="primary" data-action="confirm-insert" data-id="'+m.id+'">确认插入</button>');
    }else setDialog(action==="copy-answer"?"复制 Markdown":"保存为新文档","仅操作演示文档；此步骤不生成经历。",(action==="save-answer"?'<label>标题<input id="answer-title" value="阅读活动比较.md"></label>':'')+'<label>Markdown<textarea id="answer-md" rows="10">'+esc(md)+'</textarea></label>','<button data-action="close">返回</button><button data-action="download-answer">下载 Markdown</button><button class="primary" data-action="'+(action==="save-answer"?'confirm-answer-save':'copy-md-now')+'">'+(action==="save-answer"?'保存到演示空间':'复制 Markdown')+'</button>');
    return true;
  }
  if(action==="confirm-insert"&&m){state.note=(state.note?state.note+'\n\n':'')+answerMarkdown(m);state.saved=false;closeDialog();renderDoc();persist();toast("回答已插入演示笔记，请保存；尚未计入经历。");return true;}
  if(action==="copy-md-now"){
    const field=$("#answer-md");field.select();
    if(navigator.clipboard?.writeText)navigator.clipboard.writeText(field.value).then(()=>toast("Markdown已复制。"),()=>toast("已选中Markdown，可按系统复制快捷键。"));
    else toast("已选中Markdown，可按系统复制快捷键。");return true;
  }
  if(action==="confirm-answer-save"){
    const title=$("#answer-title").value.trim();if(!title)return toast("请填写文档标题。"),true;
    state.savedAnswers ||= [];
    const entry={id:"answer-doc-"+Date.now(),title:title.endsWith('.md')?title:title+'.md',markdown:$("#answer-md").value};
    state.savedAnswers.push(entry);state.activeDoc=entry.id;state.chatExpanded=false;state.saved=true;
    closeDialog();render();persist();toast("已保存到演示空间，尚未记录经历。");return true;
  }
  if(action==="download-answer"){
    const a=document.createElement("a"),url=URL.createObjectURL(new Blob([$("#answer-md").value],{type:"text/markdown;charset=utf-8"}));a.href=url;a.download="阅读活动比较.md";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true;
  }
  return false;
}
