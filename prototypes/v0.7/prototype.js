"use strict";
/* Offline interaction model, not a production companion implementation. */
const STORAGE = "inkstone-prototype-v07-v1";
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const stages = ["初遇", "相识", "同行", "默契", "共著"];
const roles = {
  yanzhou: {
    name: "砚舟",
    type: "成年男性人型",
    color: "#5c7460",
    accent: "#bd9b62",
    theme: "容纳未完成",
    object: "铜色书签",
    intro: "温和而认真，习惯为每份手稿留一个位置。",
    quote: "还没想清楚的部分，也可以先留在这里。",
    titles: ["空白的目录", "留一盏灯", "两份批注"],
    cg: ["留一盏灯", "两份批注"],
    choices: ["把疑问留在页边", "另起一页，慢慢写"],
    results: [
      "他在页边画了一枚细小的方框，郑重地把问号圈在里面。",
      "他抽出一张新纸，放在目录后面。空白终于有了一个正当的位置。",
    ],
  },
  zhiwei: {
    name: "知微",
    type: "成年女性人型",
    color: "#73868a",
    accent: "#98ad80",
    theme: "表达自己的判断",
    object: "叶形纸夹",
    intro: "坦率又细致，喜欢在结论旁边再留一句追问。",
    quote: "不一样的想法，也值得有自己的位置。",
    titles: ["页边的名字", "页边来信", "未完的序言"],
    cg: ["页边来信", "未完的序言"],
    choices: ["一起讨论这页批注", "安静读完这一页"],
    results: [
      "她把两种意见并排写下，在中间留了一条宽宽的空白，像一条仍可以走过去的小路。",
      "她把纸页往你这边推了一点。没有催促，铅笔就安静地放在两人之间。",
    ],
  },
  motuan: {
    name: "墨团",
    type: "非人型 · 墨色书猫",
    color: "#5b6155",
    accent: "#afc49a",
    theme: "珍惜留下的痕迹",
    object: "叶纹纸签",
    intro: "爱收集小纸签，也愿意陪你安静地读完一页。",
    quote: "一枚纸签，被轻轻放在你的手边。",
    titles: ["纸页旁的小影子", "捡到一枚书签", "午后共读"],
    cg: ["捡到一枚书签", "午后共读"],
    choices: ["夹在这本手稿里", "收进共同的书签盒"],
    results: [
      "墨团把纸签推进书页，白色爪尖压住边角。书合上时，仍有一小片叶纹露在外面。",
      "它把盒子往你面前推了推，等你放好纸签，才用鼻尖轻轻碰上盒盖。",
    ],
  },
};
const chapters = {
  yanzhou: [
    [
      "你推开书房的门时，靠窗的桌上摊着一册目录。每一行都有清楚的编号，只有最后一页留白。一个穿灰绿外套的人正将铜色书签夹进书里，听见脚步便抬起头。",
      "“我是砚舟。”他把桌边另一把椅子拉开一点，语气平常得像这本来就是它的位置。“这里的书，可以慢慢读。写到一半的，也可以先放下。”",
      "灯光落在那枚没有刻字的书签上。他没有问你带来了多少资料，只把一张干净的纸移到你面前。书房里，终于多了一个可以继续落笔的地方。",
    ],
    [
      "书房的灯换了一个角度。你再次走近书桌时，砚舟正对照两份不同年代的目录，其中有一行被擦过很多次，纸面薄得几乎能透光。",
      "他下意识用书签盖住那行字，又像忽然想起什么，将它移开。“其实没有那么要紧。”停了一会儿，他又说，“只是一直没有找到足够准确的写法。”",
      "你们把已经能确定的页码逐个核对。那些数字很安静，既没有催促那个空位被填满，也没有替任何尚未确认的结论作答。砚舟把另一张椅子拉到灯下，为两份手稿都留出合适的光。",
      "“这盏灯不必等到目录完成才亮。”他说完，似乎自己也有些意外。铜色书签上新添了一个很小的刻字，是他的名字。那份未完成的东西依旧摆在桌上，却第一次没有被收进抽屉。",
    ],
    [
      "午后的书房里，两份批注摊在桌上。同一段旧文，一份圈出“已经足够”，另一份在旁边写着“还可以继续问”。砚舟仔细看了很久，没有像往常那样将它们合成一句。",
      "“我以前总想留下一份唯一的目录。”他说，“仿佛只要每个问题都有一个位置，往后就不会迷路。”他的笔记册从外套口袋里露出一角，里面夹着不少没有编号的小纸片。",
      "他翻到最后一页。那里写的不是书名，也不是作者，而是一些很短的句子：想知道雨停后的人去了哪里；想把那封没有寄出的信重新读一次；想留一页，不为结论，只为下次继续。",
      "砚舟没有把这些句子解释成你的经历，也没有问你是否同样如此。他只是把册子放在两份手稿之间，让它们各自保留原本的样子。",
      "“如果今天不急着把两种意见合并，”他轻声问，“你愿意把这个尚未回答的问题放在哪里？”",
    ],
  ],
  zhiwei: [
    [
      "书架旁有人在一张折角纸页上写字。她停下笔，把纸翻过来，随即又翻回正面，仿佛决定不必把没有写完的部分藏起来。青灰衣料上别着一枚小小的叶形纸夹。",
      "“知微。”她指了指页边刚写下的两个字，随后笑了一下，“名字放在这里就够了，正文还可以慢慢想。”",
      "窗边空着一张椅子，桌上有两支削好的铅笔。她把其中一支推近一点。“你可以先写你的判断。不同意的地方，也留着。书房不要求每一页都只有一种声音。”纸页被风轻轻掀起，露出一段尚未命名的序言。",
    ],
    [
      "知微递给你一页折角笔记，先提醒：“有些地方我改过，但没有擦掉。”那些划线并不杂乱，旧句子仍然能辨认，新的批注沿着页边往下走。",
      "她习惯在结论后面写一句“为什么”。有时是为了核对资料，有时只是因为自己的想法还没有真正说完。她一度觉得，只有把所有疑问都处理好，才适合把纸页递给别人。",
      "“后来发现，等到那一天，大概就没有人能看见我怎么想了。”她把叶形纸夹换到纸角，露出先前压住的那句话：这一种解释，可能还漏掉了别的声音。",
      "她没有要求你赞同，也没有将分歧当作冷落。纸页停在两人之间，一支铅笔横着放好，等着一条新的批注。窗外的光慢慢移动，信纸上没有地址，也不急着得到回信。",
    ],
    [
      "知微的序言仍然没有标题，划去的句子却比以前少了。并不是她不再修改，而是新的句子终于有了足够的地方，不必将旧句子完全盖住。",
      "她把折页册放在窗边，指向其中一段：“这一页，我想说的是自己的判断。可每次写到这里，就忍不住先想别人会怎么读。”她说得坦率，没有把这句话变成需要你立即安慰的请求。",
      "书房里有一阵很轻的翻页声。你们看过的那些材料仍有各自的来源；无法证实的部分被清楚标出，没有因为纸页更好看就变成事实。她把笔记分成两栏，一边写“资料里有什么”，另一边写“我如何理解”。",
      "“这两栏，不一定总要一致。”她将叶形纸夹夹在中间，“我想先让它们都被看见。”序言的第一句重新写过，最后一句依旧空着。",
      "她把纸页往你这边移了一些，问：“这一页，今天想怎么读？”",
    ],
  ],
  motuan: [
    [
      "你刚把书摊开，页边就多了一小团影子。它没有踩上正文，只用纸白的爪尖碰了碰空白处，尾尖像一滴还没有落下的墨。",
      "书房里的人叫它墨团。它似乎还不太懂这个名字，只对纸页翻动的声音格外认真。你往后翻一页，它便侧过头，像在确认刚才那一页是不是还能找回来。",
      "一张空白纸签从书里滑出，墨团伸爪按住，又慢慢推到你手边。它没有替你读完书，也没有替你写出结论，只在纸签旁蜷成一个小小的逗号。窗边的阅读灯亮着，这一页可以从这里继续。",
    ],
    [
      "纸堆里传来很轻的窸窣声。墨团探出头，额前沾着一小片纸屑，爪下压着一枚空白书签。它将书签拖到灯下，又将它推回阴影，反复看了几次。",
      "你发现它的墨色里多了一道浅淡叶纹，像刚晾干的拓印。它自己似乎也有些惊讶，试着用白色爪尖去碰那道纹路，没碰到，便装作原本只是想洗脸。",
      "桌上的书仍停在上次留下的位置。墨团没有试图判断哪一页更重要，只把散落的小纸签一枚枚排在旁边。有一枚很旧，有一枚边角不齐，还有一枚只写着虚构的页码。",
      "它最后选中最普通的那枚，放进空着的小盒子，再抬头看你。纸片的价值似乎不全在于上面写了什么：有谁认真读过，也愿意以后回来。它打了个很小的哈欠，将盒盖留开一道缝。",
    ],
    [
      "午后的光正好落在书页边缘，墨团趴在那条光带上，尾巴绕着一枚新完成的纸签。叶纹比从前清楚了，却没有盖过它原本的墨色。白色爪尖仍是原来的样子。",
      "小盒子里已经有几枚书签。它将其中一枚叼出来，放在你手边，又不放心地用爪子摆正。纸签上没有真实文档的标题，只有一条虚构的细线，像一条刚找到方向的小路。",
      "你翻开书时，墨团会抬头；你停下来，它便把耳朵转向窗外。它没有因停顿而着急，也没有把没有读完的页数算作欠下的事情。阅读的节奏在一阵阵翻页声里慢慢安定下来。",
      "它忽然将盒子推近，将那枚书签叼到盒边，再望一眼摊开的手稿。两个位置都很妥当，似乎只是看你今天想怎样留下这一小段痕迹。",
      "墨团坐稳，纸白的尾尖轻轻动了一下。书签落在你的手边，等着一个简单的决定。",
    ],
  ],
};

chapters.yanzhou[1].push(
  "他为灯拉好帘罩，又将未完成的目录放回原处。这一次，书签没有遮住空行，灯也没有因为缺一个结尾而熄灭。",
);
chapters.zhiwei[1].push(
  "临走前，她在折角处写了当天的虚构日期。“不是寄出的时间，”她说，“是愿意把这页留下来的时间。”",
);
chapters.motuan[1].push(
  "盒子被安放在书架最下层，伸手就能碰到。墨团来回看了两眼，终于靠着它坐下，尾巴圈出一个安稳的小圆。",
);
chapters.yanzhou[2].splice(
  4,
  0,
  "他从旧目录里抽出最早的一张草稿，边角已经有些卷起。那时他为每个空位都画了一个框，甚至连框的大小也仔细量过；但真正想写的话，始终没有被放进去。现在，那张纸被平平整整铺开，既不用装成完成稿，也不必被当作废纸扔掉。你们为它找了一个夹层，靠近随时可以打开的地方。砚舟像是终于明白：整理不是让所有问题消失，而是让下次回来的人知道，哪里还可以接着想。他没有立刻为这个念头命名，只把铅笔转向空白的一端。",
);
chapters.zhiwei[2].splice(
  4,
  0,
  "她把反复划掉的旧句子读了一遍，没有再用力涂黑。“这里的犹豫也是怎么走到今天的一部分。”话音落下，她自己先停了停，像是在确认这句话确实是她愿意留下的判断。你们没有把序言改成一份共同签名的结论，也没有为了消除分歧删去其中一栏。铅笔将两栏之间的线描得更清楚，空白却保留着，容得下新的资料，也容得下以后改变看法的人。窗边的光移过折角，叶形纸夹在纸上投下一小片影子。",
);
chapters.motuan[2].splice(
  4,
  0,
  "纸签盒里有一层很薄的软纸，墨团曾经试着把它压平，最后留下一枚浅浅的爪印。你这才看清，盒中每一枚纸签的边缘都不完全一样：有的被折过，有的在灯下晒得更暖，还有的只在一页书里待过片刻。它没有将新纸签放在最上面，也没有把旧的藏到底下，只给它们各自留一点空隙。被认真读过的痕迹不需要比赛，也不必证明哪一段陪伴更长。墨团伸了个懒腰，将一枚歪掉的纸签拨正，又轻轻往你这边推近。",
);

const docs = [
  {
    id: "reading",
    title: "阅读活动方案.md",
    heading: "让每次阅读，都能接着往下",
    caption: "项目笔记 · 北岸图书馆（虚构示例）",
    html: '<p class="lead">比较两种阅读活动，保留事实，也保留接下来要问的问题。</p><h2>两种方案</h2><p>甲方案安排在周二，参与人数为 120 人；乙方案安排在周四，参与人数为 80 人。数字仅用于演示知识问答与引用。</p><table><thead><tr><th>活动</th><th>时间</th><th>参与人数</th></tr></thead><tbody><tr><td>甲方案</td><td>周二</td><td>120 人</td></tr><tr><td>乙方案</td><td>周四</td><td>80 人</td></tr></tbody></table><h2>下一步核对</h2><ul><li>核对场地容量，避免把参与人数等同于满意度。</li><li>补充不同时间段的反馈，再决定后续安排。</li></ul><blockquote>把确定的写清楚，把未确定的留在下一页。</blockquote>',
  },
  {
    id: "review",
    title: "一周复盘.md",
    heading: "这一周，留下了什么",
    caption: "复盘笔记 · 虚构工作记录",
    html: '<p class="lead">完成一份笔记之后，再给自己的判断留一点余地。</p><h2>已经完成</h2><ul><li>整理两种阅读活动的基础信息。</li><li>区分事实、推断与尚待核对的问题。</li></ul><h2>下次继续</h2><p>补充资料的来源与时间，再比较不同方案。</p>',
  },
  {
    id: "relations",
    title: "资料关系与待办.md",
    heading: "把散落的线索，连在一起",
    caption: "资料索引 · 虚构关系",
    html: '<p class="lead">相互关联的材料，比单独的一页更容易接续。</p><h2>资料关系</h2><ul><li>阅读活动方案 → 场地安排。</li><li>一周复盘 → 下一次调查。</li></ul><h2>项目里程碑</h2><p>完成第一轮比较，明确仍需补充的资料。</p>',
  },
  {
    id: "draft",
    title: "窗边手稿.md",
    heading: "先写到这里",
    caption: "自由手稿 · 虚构内容",
    html: '<p class="lead">不必每次都把最后一句写完。</p><p>窗外风停的时候，书页也停下来。一个还没找到答案的问题，被夹在铜色书签旁边。</p><h2>可以继续的地方</h2><p>读完这一段，再想一想为什么。</p>',
  },
];
function initial() {
  return {
    version: 1,
    character: null,
    enabled: true,
    mode: "focus",
    reduced: true,
    activeDoc: "reading",
    editorMode: "body",
    day: "2026-11-05",
    ledger: [],
    cards: [],
    preferences: [],
    roles: {},
    outfits: {},
    answer: "empty",
    tab: "ask",
    pending: null,
    failReward: false,
    note: "",
    saved: true,
  };
}
let state = initial();
try {
  const old = JSON.parse(localStorage.getItem(STORAGE));
  if (old?.version === 1) state = { ...state, ...old };
} catch {}
let selectedRole = state.character || "zhiwei",
  selectedMode = state.mode,
  panelTab = "growth",
  activeChapter = 0,
  toastTimer,
  returnFocus = null;
function persist() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(state));
    return true;
  } catch {
    toast("浏览器存储不可用，当前演示可继续；刷新后不会保留。");
    return false;
  }
}
function progress(id = state.character) {
  if (!id) return { read: [], choice: null };
  if (!state.roles[id]) state.roles[id] = { read: [], choice: null };
  return state.roles[id];
}
function level(id = state.character) {
  const p = progress(id);
  return p.read.includes(2) ? 2 : p.read.includes(1) ? 1 : 0;
}
function counts() {
  return {
    events: state.ledger.length,
    days: new Set(state.ledger.map((e) => e.day)).size,
  };
}
function eligible(id = state.character) {
  if (!id) return null;
  const p = progress(id),
    c = counts();
  if (!p.read.includes(0)) return 0;
  if (
    !p.read.includes(1) &&
    c.events >= 3 &&
    c.days >= 2 &&
    state.ledger.some((e) => e.milestone)
  )
    return 1;
  if (
    p.read.includes(1) &&
    !p.read.includes(2) &&
    c.events >= 8 &&
    c.days >= 5 &&
    state.ledger.some((e) => e.kind === "revision")
  )
    return 2;
  return null;
}
function art(id, stage = 0, scene = false) {
  const r = roles[id],
    t = stage === 0 ? "初遇" : stage === 1 ? "相识" : "同行";
  let shape;
  if (id === "motuan")
    shape =
      '<path d="M121 136 Q106 108 128 80 L126 47 L150 63 Q171 55 185 65 L205 45 L207 87 Q230 111 207 142 Z" fill="' +
      r.color +
      '"/><ellipse cx="166" cy="152" rx="54" ry="48" fill="' +
      r.color +
      '"/><path d="M204 171 Q253 185 248 133" fill="none" stroke="' +
      r.color +
      '" stroke-width="18" stroke-linecap="round"/><ellipse cx="144" cy="185" rx="14" ry="8" fill="#f4f3df"/><ellipse cx="185" cy="185" rx="14" ry="8" fill="#f4f3df"/><path d="M146 99h8m28 0h8" stroke="#dce2c2" stroke-width="3" stroke-linecap="round"/>' +
      (stage > 0
        ? '<path d="M163 125q11-15 16-2q-6 10-16 2" fill="#a5bb8e"/>'
        : "") +
      (stage > 1
        ? '<path d="M161 140h20l-4 23-8 6-8-6z" fill="#e5d7b5"/>'
        : "");
  else
    shape =
      '<path d="M116 201 Q111 143 144 131 L185 131 Q218 144 216 201 Z" fill="' +
      r.color +
      '"/><path d="M146 132l17 44 20-44" fill="#eeeadc"/><path d="M139 67 Q163 43 190 70 L191 115 Q171 139 146 117 Z" fill="#d8c6aa"/><path d="M137 83 Q127 48 161 43 Q207 38 199 101 L188 75 Q165 80 146 67 L142 110Z" fill="' +
      (id === "zhiwei" ? "#4d5149" : "#454d42") +
      '"/><path d="M150 96h7m20 0h7" stroke="#6c695a" stroke-width="2" stroke-linecap="round"/><path d="M163 113q5 3 11-1" fill="none" stroke="#9d8871" stroke-width="1.5"/>' +
      (id === "zhiwei"
        ? '<path d="M192 73q13-14 18-1q-4 13-18 1" fill="' + r.accent + '"/>'
        : '<path d="M193 153h7v22l-4-4-3 4z" fill="' + r.accent + '"/>') +
      (stage > 0
        ? '<path d="M116 167q31-11 65 21l-7 13h-51" fill="#8d9b7e"/><rect x="161" y="165" width="35" height="29" rx="2" fill="#c8bc99"/>'
        : "") +
      (stage > 1
        ? '<path d="M119 139q11-13 23-7l-11 62-21-1" fill="#a6b28f"/>'
        : "");
  return (
    '<svg viewBox="0 0 330 220" preserveAspectRatio="' +
    (scene ? "xMidYMid meet" : "xMidYMid slice") +
    '" role="img" aria-label="' +
    r.name +
    " " +
    t +
    '，仅构图示意"><rect width="330" height="220" fill="#e4e9da"/><path d="M20 25h85v122H20z" fill="#f3f4e4" stroke="#c5d0b7"/><path d="M62 25v122M20 87h85" stroke="#c5d0b7"/><path d="M225 50h83m-83 28h83m-83 28h83" stroke="#c5cfb7" stroke-width="3"/><path d="M232 48V29m12 19V20m13 28V30m13 18V26m17 22V22" stroke="#a6b394" stroke-width="9"/><path d="M1 201h329v19H1z" fill="#c8cbb3"/>' +
    shape +
    (scene
      ? '<path d="M29 196l38-22 43 22-41 13z" fill="#f7f3dd" stroke="#b7b99e"/><path d="M66 178l2 29" stroke="#c9c8ae"/><path d="M267 194v-53m-24-2h48l-11-30h-28z" fill="#d5c697" stroke="#9eab8c"/><ellipse cx="269" cy="197" rx="16" ry="3" fill="#a6af96"/>'
      : "") +
    "</svg>"
  );
}
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 4200);
}
function setDialog(title, description, body, footer = "", tabs = "") {
  const d = $("#modal");
  if (!d.open) returnFocus = document.activeElement;
  $("#modal-content").innerHTML =
    '<div class="dialog-head"><div><h2 id="modal-title">' +
    title +
    "</h2><p>" +
    description +
    '</p></div><button data-action="close" aria-label="关闭面板">×</button></div>' +
    tabs +
    '<div class="dialog-main">' +
    body +
    "</div>" +
    (footer ? '<div class="dialog-foot">' + footer + "</div>" : "");
  if (!d.open) d.showModal();
  else $("#modal-content").querySelector("button,input,[tabindex]")?.focus();
}
function closeDialog() {
  if ($("#modal").open) $("#modal").close();
  returnFocus?.focus();
}
function renderDoc() {
  const doc = docs.find((d) => d.id === state.activeDoc) || docs[0];
  $("#breadcrumb").innerHTML = "砚间书房 <span>›</span> " + esc(doc.title);
  $("#editor").innerHTML =
    state.editorMode === "source"
      ? '<pre class="source-code"># ' +
        esc(doc.heading) +
        "\n\n" +
        esc(doc.caption) +
        "\n\n" +
        esc(doc.html.replace(/<[^>]+>/g, "\n").replace(/\n+/g, "\n\n")) +
        "\n\n## 留给下一页\n\n" +
        esc(state.note) +
        "</pre>"
      : '<p class="eyebrow">READ · THINK · KEEP</p><h1>' +
        doc.heading +
        '</h1><p class="microcopy">' +
        doc.caption +
        "</p>" +
        doc.html +
        '<h2>留给下一页</h2><div id="demo-note" class="note-lines" contenteditable="true" role="textbox" aria-label="演示笔记，可以输入" aria-multiline="true">' +
        esc(state.note || "点击这里，写一句接下来想做的事。") +
        "</div>";
  $("#body-tab").classList.toggle("active", state.editorMode === "body");
  $("#source-tab").classList.toggle("active", state.editorMode === "source");
  renderList();
  $("#save-status").textContent =
    (state.saved ? "已保存" : "有未保存的演示修改") + " · 演示文档";
}
function renderList() {
  const q = $("#document-search").value.trim();
  $("#doc-list").innerHTML =
    docs
      .filter((d) => d.title.includes(q))
      .map(
        (d) =>
          '<button data-action="open-doc" data-id="' +
          d.id +
          '" class="doc-button ' +
          (state.activeDoc === d.id ? "selected" : "") +
          '"><span class="doc-symbol" aria-hidden="true">▤</span><span>' +
          d.title +
          "</span></button>",
      )
      .join("") || '<p class="microcopy">没有匹配的演示文档。</p>';
}
function renderCompanion() {
  document.body.classList.toggle("reduced", state.reduced);
  if (!state.enabled) {
    $("#companion").innerHTML =
      '<div class="disabled-card"><span>陪伴已关闭 · 工作功能照常使用</span><button data-action="enable">开启</button></div>';
    return;
  }
  if (!state.character) {
    $("#companion").innerHTML =
      '<div class="choose-intro"><div class="eyebrow">THE INKSTONE STUDY</div><h2>让书房，多一位同伴</h2><p>有人陪你慢慢想，也有人安静地守着这一页。选择你喜欢的相处方式。</p><button class="primary" data-action="choose">认识书房同伴</button><button data-action="disable">暂不开启</button></div>';
    return;
  }
  const r = roles[state.character],
    p = progress(),
    lv = level(),
    outfit = state.outfits[state.character] ?? lv,
    next = eligible();
  const line = state.pending
    ? "工作已保存，经历待保存。"
    : state.mode === "focus"
      ? "专注模式 · 只显示必要状态"
      : r.quote;
  $("#companion").innerHTML =
    '<div class="companion-card"><div class="companion-primary"><div class="portrait">' +
    art(state.character, outfit) +
    '</div><div class="companion-info"><div class="companion-name"><strong>' +
    r.name +
    '</strong><span class="stage-badge">' +
    stages[lv] +
    "</span></div><p>" +
    line +
    '</p><button data-action="panel" data-tab="settings">形象与陪伴设置</button></div></div><div class="companion-links"><button data-action="panel" data-tab="experiences">共同经历</button><button data-action="panel" data-tab="stories">角色故事</button><button data-action="panel" data-tab="album">CG 相册</button></div>' +
    (next !== null
      ? '<div class="quiet-flag"><span class="local-dot"></span>' +
        (next === 0 ? "相遇短章待阅读" : "新章节可阅读 · " + stages[next]) +
        '<button data-action="story" data-stage="' +
        next +
        '">查看 →</button></div>'
      : "") +
    (state.pending
      ? '<div class="quiet-flag">经历尚未计入<button data-action="retry-reward">重试保存</button></div>'
      : "") +
    "</div>";
}
function renderKnowledge() {
  const body = $("#knowledge-body");
  $("#ask-tab").classList.toggle("selected", state.tab === "ask");
  $("#search-tab").classList.toggle("selected", state.tab === "search");
  if (state.tab === "search") {
    body.innerHTML =
      '<p class="microcopy">固定检索示例 · 当前空间</p><div class="source-card"><strong>阅读活动方案.md</strong><p>甲方案：周二，120人。乙方案：周四，80人。</p><span class="source-tag">演示来源 S1 · 第 4–8 行</span></div><p class="microcopy">角色故事与个人偏好不在文档索引中。</p>';
    return;
  }
  if (state.answer === "error") {
    body.innerHTML =
      '<div class="answer-notice" role="alert"><strong>问答暂未完成</strong><br>演示服务超时。文档已经保存，未生成答案，也没有新增经历。<br><button data-action="retry-answer">重试演示问答</button></div>';
    return;
  }
  if (state.answer === "answer") {
    body.innerHTML =
      '<div class="answer"><span class="answer-label">知识回答 · 固定演示内容</span><h3>甲方案参与人数较多</h3><p>甲方案为 <strong>120 人</strong>，乙方案为 <strong>80 人</strong>，相差 40 人。<span class="source-tag">S1</span></p><table class="answer-table"><thead><tr><th>方案</th><th>时间</th><th>人数</th></tr></thead><tbody><tr><td>甲</td><td>周二</td><td>120 人</td></tr><tr><td>乙</td><td>周四</td><td>80 人</td></tr></tbody></table><p>资料不足以判断满意度或方案优劣，建议补充反馈数据。</p><div class="fact-source"><button class="source-tag" data-action="sources">S1 · 阅读活动方案.md</button><p>来源、数字与表格不随角色切换。新增角色化模型请求：0。</p></div></div>';
    return;
  }
  body.innerHTML =
    '<div class="empty-answer"><span>一页资料，<br>一点新发现。</span>从已有材料开始，把问题说清楚。<button class="prompt-sample" data-action="sample-question">比较两种阅读活动的参与人数，并列出资料不足的部分 ↗</button><p class="microcopy">演示仅覆盖这一问答，不模拟通用模型能力。</p></div>';
}
function render() {
  renderDoc();
  renderCompanion();
  renderKnowledge();
  persist();
}
function choose() {
  selectedRole = state.character || "zhiwei";
  selectedMode = state.mode;
  renderChoice();
}
function renderChoice() {
  setDialog(
    "选择书房同伴",
    "三类角色自由选择，不按用户性别分配；工作与知识能力完全相同。",
    '<div class="role-grid">' +
      Object.entries(roles)
        .map(
          ([id, r]) =>
            '<button data-action="select-role" data-id="' +
            id +
            '" class="role-card ' +
            (selectedRole === id ? "selected" : "") +
            '" aria-pressed="' +
            (selectedRole === id) +
            '"><div class="role-art">' +
            art(id, 0) +
            '<span class="art-label">角色构图示意 · 非最终立绘</span></div><div class="role-copy"><h3>' +
            r.name +
            "</h3><small>" +
            r.type +
            " · " +
            r.object +
            "</small><p>" +
            r.intro +
            "</p><blockquote>“" +
            r.quote +
            "”</blockquote></div>" +
            (selectedRole === id
              ? '<span class="role-selected" aria-hidden="true">✓</span>'
              : "") +
            "</button>",
        )
        .join("") +
      '</div><div class="mode-choice"><p>想以哪种方式相处？</p><div class="radio-grid"><label class="radio-card"><input name="choose-mode" type="radio" value="focus" ' +
      (selectedMode === "focus" ? "checked" : "") +
      '><span>专注<small>安静陪同，保留状态与故事入口。</small></span></label><label class="radio-card"><input name="choose-mode" type="radio" value="gentle" ' +
      (selectedMode === "gentle" ? "checked" : "") +
      '><span>温和陪伴<small>在真实操作之外，多一句简短回应。</small></span></label></div></div><p class="microcopy">可随时更换或关闭。离开不会失去进度；不会自动读取文档建立私人记忆。</p>',
    '<span class="foot-note">示意图只用于验证构图和占位尺寸，最终美术另行制作。</span><button data-action="close">稍后再选</button><button class="primary" data-action="apply-role">与' +
      roles[selectedRole].name +
      "相遇 →</button>",
  );
}
function preferenceScopeId(scope) {
  return scope === "当前角色"
    ? state.character
    : scope === "当前空间"
      ? "demo-study"
      : "*";
}
function preferenceScopeLabel(pref) {
  return pref.scope === "当前角色"
    ? "角色 · " + (roles[pref.scopeId]?.name || "旧记录未绑定，请重新确认")
    : pref.scope === "当前空间"
      ? "空间 · 砚间书房"
      : "全局";
}
function panel(tab = panelTab) {
  if (!state.character) {
    choose();
    return;
  }
  panelTab = tab;
  const r = roles[state.character],
    lv = level(),
    c = counts(),
    next = eligible();
  let body = "";
  const tabs =
    '<nav class="panel-tabs" aria-label="角色面板">' +
    [
      ["growth", "成长手札"],
      ["experiences", "共同经历"],
      ["stories", "角色故事"],
      ["album", "CG 相册"],
      ["settings", "偏好与数据"],
    ]
      .map(
        ([id, label]) =>
          '<button data-action="panel" data-tab="' +
          id +
          '" class="' +
          (tab === id ? "active" : "") +
          '" aria-current="' +
          (tab === id ? "page" : "false") +
          '">' +
          label +
          "</button>",
      )
      .join("") +
    "</nav>";
  if (tab === "growth") {
    const goal =
      lv === 0
        ? { events: 3, days: 2 }
        : lv === 1
          ? { events: 8, days: 5 }
          : { events: 16, days: 12 };
    body =
      '<div class="panel-topline"><div><h3>把认真留下的，慢慢积成故事</h3><small>' +
      r.name +
      " · " +
      r.theme +
      '</small></div><button class="secondary" data-action="choose">更换角色</button></div><div class="stages">' +
      stages
        .map(
          (name, i) =>
            '<div class="stage-item ' +
            (i < lv ? "done " : i === lv ? "current " : i > 2 ? "later" : "") +
            '"><span class="stage-number">0' +
            (i + 1) +
            "</span><strong>" +
            name +
            "</strong><small>" +
            (i <= lv ? "形象已解锁" : i > 2 ? "v0.8 规划" : "故事待展开") +
            "<br>" +
            [
              "相遇介绍",
              "3 条经历 · 2 日",
              "8 条经历 · 5 日",
              "16 条经历 · 12 日",
              "30 条经历 · 24 日",
            ][i] +
            "</small></div>",
        )
        .join("") +
      '</div><div class="progress-row"><div><span>已确认经历</span><span>' +
      c.events +
      " / " +
      goal.events +
      '</span></div><progress class="progress-track" value="' +
      Math.min(c.events, goal.events) +
      '" max="' +
      goal.events +
      '" aria-label="经历进度"></progress></div><div class="progress-row"><div><span>有经历的不同使用日</span><span>' +
      c.days +
      " / " +
      goal.days +
      '</span></div><progress class="progress-track" value="' +
      Math.min(c.days, goal.days) +
      '" max="' +
      goal.days +
      '" aria-label="不同使用日进度"></progress></div><div class="criteria"><strong>下一章还需要</strong><ul><li>有效经历与不同使用日同时满足；不要求连续使用。</li><li>' +
      (lv === 0
        ? "确认首份笔记或工作里程碑，完成或明确跳过初遇短章。"
        : lv === 1
          ? "完成一次复盘或修订，完成或明确跳过相识章节。"
          : "默契与共著在 v0.8 交付，本原型不提前解锁。") +
      "</li><li>同文档/里程碑每日最多1条，全局每日最多2条；自动保存、导入与API消费不计入。</li></ul></div>" +
      (next !== null
        ? '<div class="callout"><strong>有一页故事，等你方便时打开。</strong><p><button class="primary" data-action="story" data-stage="' +
          next +
          '">阅读' +
          stages[next] +
          "章节 →</button></p>达到条件不会在写作中弹窗。</div>"
        : '<p class="microcopy">门槛是试用初值，不承诺固定第几天成长。关闭陪伴不回扫文档补记。</p>');
  }
  if (tab === "experiences") {
    body =
      '<div class="panel-topline"><div><h3>共同经历</h3><small>' +
      c.events +
      ' 条已计入 · 卡片内容由你确认</small></div><button class="secondary" data-action="confirm-work">记录本次完成</button></div>' +
      (state.pending
        ? '<div class="callout warning">工作已保存，经历尚未保存。重试沿用同一操作标识，不会重复计入。<button data-action="retry-reward" class="secondary">重试保存</button></div>'
        : "") +
      (state.cards.length
        ? state.cards
            .slice()
            .reverse()
            .map(
              (card) =>
                '<div class="experience-row"><span class="event-marker" aria-hidden="true">✓</span><div><strong>' +
                esc(card.text) +
                "</strong><small>" +
                esc(card.day) +
                " · " +
                (card.role === state.character
                  ? "与" + r.name + "共同记录"
                  : "来自你的工作履历") +
                " · " +
                esc(card.kind === "revision" ? "复盘修订" : "本次完成") +
                '</small></div><button data-action="edit-card" data-id="' +
                card.id +
                '">编辑</button><button data-action="delete-card" data-id="' +
                card.id +
                '">删除卡片</button></div>',
            )
            .join("")
        : '<div class="empty-panel">这里会留下你愿意记录的工作片段。<br>普通保存不会自动变成经历。</div>') +
      '<p class="microcopy">删除卡片会移除其文本与来源；去重/成长的最小账本保留，已获形象不收回。彻底清空可在“偏好与数据”完成。</p>';
  }
  if (tab === "stories") {
    body =
      '<div class="panel-topline"><div><h3>' +
      r.name +
      '的故事</h3><small>固定剧情 · 离线重看 · 一次选择后重新汇合</small></div></div><div class="story-list">' +
      r.titles
        .map((title, i) => {
          const read = progress().read.includes(i),
            can = read || eligible() === i;
          return (
            '<div class="story-row"><span class="stage-number">0' +
            (i + 1) +
            "</span><div><strong>" +
            title +
            "</strong><small>" +
            stages[i] +
            " · " +
            (read
              ? progress().skipped?.includes(i)
                ? "已明确跳过，可重看"
                : "已读，可重看"
              : can
                ? "已满足开启条件"
                : "成长条件未满足") +
            '</small></div><button data-action="story" data-stage="' +
            i +
            '" ' +
            (!can ? "disabled" : "") +
            ">" +
            (read ? "重看" : can ? "打开章节" : "未解锁") +
            "</button></div>"
          );
        })
        .join("") +
      '</div><div class="callout">默契与共著是 v0.8 的后续章节。每角色整条故事共两个关键选择，v0.7只提供“同行”的第一个。</div>';
  }
  if (tab === "album") {
    body =
      '<div class="panel-topline"><div><h3>CG 相册</h3><small>' +
      r.name +
      ' · 解锁后离线重看</small></div></div><div class="album-grid">' +
      r.cg
        .map((name, i) => {
          const open = progress().read.includes(i + 1);
          return (
            '<button class="album-card ' +
            (!open ? "locked" : "") +
            '" data-action="cg" data-stage="' +
            (i + 1) +
            '"><div class="album-picture">' +
            (open
              ? art(state.character, i + 1, true)
              : '<span aria-hidden="true">◇</span>') +
            '<span class="art-label">' +
            (open ? "CG构图示意 · 非最终插画" : "待解锁") +
            '</span></div><div class="album-copy"><strong>' +
            name +
            "</strong><small>" +
            stages[i + 1] +
            " · " +
            (open ? "查看构图与剧情注释" : "达到条件后阅读或明确跳过章节") +
            "</small></div></button>"
          );
        })
        .join("") +
      '<div class="album-card locked"><div class="album-picture"><span aria-hidden="true">◇</span></div><div class="album-copy"><strong>后续故事</strong><small>共著 · v0.8规划</small></div></div></div><p class="album-caption">本原型只有程序绘制的构图示意，最终CG尚未制作；正式v0.7需9张阶段立绘、6张主CG。画中纸页使用虚构内容，不自动绘入私人文档。</p>';
  }
  if (tab === "settings") {
    body =
      '<div class="panel-topline"><div><h3>由你决定，如何相处</h3><small>设置与工作文档分开保存</small></div><button class="secondary" data-action="choose">更换角色</button></div><div class="settings-grid"><label>陪伴强度<select id="setting-mode"><option value="focus" ' +
      (state.mode === "focus" ? "selected" : "") +
      '>专注</option><option value="gentle" ' +
      (state.mode === "gentle" ? "selected" : "") +
      '>温和陪伴</option></select></label><label>当前形象<select id="setting-outfit">' +
      stages
        .slice(0, lv + 1)
        .map(
          (name, i) =>
            '<option value="' +
            i +
            '" ' +
            ((state.outfits[state.character] ?? lv) === i ? "selected" : "") +
            ">" +
            name +
            " · 已解锁</option>",
        )
        .join("") +
      '</select></label></div><label class="toggle-row"><div>开启角色陪伴<small>关闭后停止角色动作与新增经历；重新开启不自动补记。</small></div><input id="setting-enabled" type="checkbox" ' +
      (state.enabled ? "checked" : "") +
      '></label><label class="toggle-row"><div>减少动态效果<small>默认开启；不播放背景音乐和自动语音。</small></div><input id="setting-reduced" type="checkbox" ' +
      (state.reduced ? "checked" : "") +
      '></label><div class="settings-section"><h3>你确认过的偏好</h3>' +
      (state.preferences.length
        ? state.preferences
            .map(
              (pref) =>
                '<div class="pref-row"><div><strong>' +
                esc(pref.text) +
                "</strong><small>来源：手动确认 · " +
                esc(preferenceScopeLabel(pref)) +
                " · " +
                (pref.enabled ? "已启用" : "已停用") +
                '</small></div><button data-action="edit-pref" data-id="' +
                pref.id +
                '">修改</button><button data-action="toggle-pref" data-id="' +
                pref.id +
                '">' +
                (pref.enabled ? "停用" : "启用") +
                '</button><button data-action="delete-pref" data-id="' +
                pref.id +
                '">删除</button></div>',
            )
            .join("")
        : '<p class="microcopy">尚未记录偏好。不从文档推断你的身份、性格或情绪。</p>') +
      '<form id="memory-form" class="memory-form"><label>新偏好<input id="memory-text" placeholder="例如：回答先给结论" maxlength="100" required></label><label>使用范围<select id="memory-scope"><option>全局</option><option>当前空间</option><option>当前角色</option></select></label><div class="actions"><button class="secondary" type="submit">确认并保存偏好</button></div></form></div><div class="settings-section"><h3>查看与导出</h3><p class="microcopy">导出演示设置、经历卡、已确认偏好与故事进度。生产备份另需明确纳入companion.db。</p><button class="secondary" data-action="export">查看并导出演示数据</button></div><div class="settings-section danger-zone"><div><h3>清空角色数据</h3><p>移除演示经历、偏好、故事与解锁。四份演示工作文档保持独立。</p></div><button class="danger" data-action="clear-companion">清空角色数据…</button></div>';
  }
  setDialog(
    r.name + " · 砚间书房",
    "角色原型 · 演示数据与生产 Inkstone 完全分开",
    body,
    '<span class="foot-note">Esc 关闭面板，回到打开它的位置。</span><button class="secondary" data-action="close">回到工作</button>',
    tabs,
  );
}
function story(stage) {
  if (!state.character) return choose();
  if (!progress().read.includes(stage) && eligible() !== stage) {
    toast("还未满足该章节条件，可在成长手札查看。");
    return;
  }
  activeChapter = stage;
  const r = roles[state.character],
    read = progress().read.includes(stage),
    choice = progress().choice;
  setDialog(
    r.titles[stage],
    r.name + " · " + stages[stage] + " · 固定剧情草案，可随时关闭后重看",
    '<figure class="story-scene"><div>' +
      art(state.character, stage, true) +
      '</div><figcaption>仅示意角色/书房构图与阅读区域；最终立绘、CG尚待制作。</figcaption></figure><div class="story-text">' +
      chapters[state.character][stage].map((p) => "<p>" + p + "</p>").join("") +
      "</div>" +
      (stage === 2
        ? '<div class="story-choice">' +
          r.choices
            .map(
              (text, i) =>
                '<button data-action="story-choice" data-index="' +
                i +
                '" class="' +
                (choice === i ? "chosen" : "") +
                '" ' +
                (choice !== null ? "disabled" : "") +
                ">" +
                text +
                (choice === i ? " ✓" : "") +
                "</button>",
            )
            .join("") +
          "</div>" +
          (choice !== null
            ? '<div class="choice-result">' +
              r.results[choice] +
              "<p>" +
              {
                yanzhou:
                  "这一页没有变成最终的答案，却已经可以好好留下。砚舟将两份批注分别夹好，没有让任何一种声音消失。",
                zhiwei:
                  "知微为序言添上一行很小的日期。最后一句还空着，但这一页已经不必藏起来。",
                motuan:
                  "墨团轻轻收起爪尖，继续守着光带。它没有催促你翻到下一页，纸签已经好好留在选定的位置。",
              }[state.character] +
              "</p></div>"
            : '<p class="microcopy">两种选择都正常推进，不改变成长速度。明确跳过也可稍后补选。</p>')
        : ""),
    '<span class="foot-note">' +
      (read
        ? "已处理章节，重看不会重复解锁。"
        : "关闭仅保留阅读入口；明确跳过同样记录章节进度。") +
      '</span><button data-action="skip-story">明确跳过本章</button><button class="primary" data-action="finish-story" ' +
      (stage === 2 && choice === null ? "disabled" : "") +
      ">" +
      (read ? "返回故事目录" : "读完，留下这一页") +
      "</button>",
  );
}
function finishStory(skip) {
  const p = progress();
  if (!p.read.includes(activeChapter)) p.read.push(activeChapter);
  if (skip) {
    p.skipped = p.skipped || [];
    if (!p.skipped.includes(activeChapter)) p.skipped.push(activeChapter);
  }
  persist();
  renderCompanion();
  panel("stories");
  toast(
    skip
      ? "已明确跳过，章节与形象已记录；可以随时重看。"
      : "章节已记录，形象与CG已解锁。",
  );
}
function confirmWork() {
  if (state.pending) {
    toast("有一条经历待保存，请先重试保存，避免覆盖原来的记录。");
    return;
  }
  if (!state.character || !state.enabled) {
    toast("陪伴尚未开启；普通保存与问答仍可使用。");
    if (!state.character) choose();
    return;
  }
  if (!state.saved) {
    toast("请先保存当前演示笔记，再确认完成。");
    return;
  }
  const doc = docs.find((d) => d.id === state.activeDoc);
  setDialog(
    "确认本次完成",
    "工作已经保存；由你决定是否留下这段经历。",
    '<div class="confirm-form"><div class="callout">当前演示日期：' +
      state.day +
      '。不自动读取正文或把标题写进卡片。</div><label for="event-kind">经历类型</label><select id="event-kind"><option value="complete">本次完成</option><option value="revision">复盘修订</option><option value="milestone">工作里程碑</option></select><label for="event-text">拟保存的经历卡</label><textarea id="event-text" rows="3" maxlength="140">完成一份资料整理</textarea><label class="check-line"><input id="event-consent" type="checkbox" checked><span>保存以上简短文字；本次经历关联当前演示对象以便去重。默认不保存真实标题或正文。</span></label><p class="microcopy">当前对象：' +
      doc.title +
      "（演示）。同一对象每天最多1条，全局每天最多2条。知识内容是否正确，由你自行核对。</p></div>",
    '<button data-action="close">暂不记录</button><button class="primary" data-action="submit-event">确认并记录</button>',
  );
}
function addEvent() {
  if (state.pending) {
    toast("已有经历待保存，本次未覆盖，请先重试。");
    return;
  }
  const text = $("#event-text").value.trim(),
    kind = $("#event-kind").value;
  if (!text || !$("#event-consent").checked) {
    toast("请填写经历卡并确认保存。");
    return;
  }
  const id = "demo-" + state.day + "-" + state.activeDoc,
    existing = state.ledger.some((e) => e.id === id),
    daily = state.ledger.filter((e) => e.day === state.day).length;
  if (existing) {
    toast("这份文档今天已经计入，不重复发放。");
    return;
  }
  if (daily >= 2) {
    toast("今天已记录两条有效经历；工作仍可继续，明日不要求连续使用。");
    return;
  }
  state.pending = {
    id,
    day: state.day,
    objectId: state.activeDoc,
    role: state.character,
    text,
    kind,
    milestone: true,
  };
  closeDialog();
  if (state.failReward) {
    state.failReward = false;
    persist();
    renderCompanion();
    toast("工作已保存；经历写入失败，尚未计入，可重试。");
  } else commitPending();
}
function commitPending() {
  const event = state.pending;
  if (!event) return;
  const existed = state.ledger.some((e) => e.id === event.id);
  if (!existed) {
    state.ledger.push({
      id: event.id,
      day: event.day,
      kind: event.kind,
      milestone: event.milestone,
      role: event.role,
      objectId: event.objectId,
    });
    state.cards.push({ ...event });
  }
  state.pending = null;
  persist();
  renderCompanion();
  if ($("#modal").open) panel("experiences");
  toast(
    existed
      ? "该经历已经记录，没有重复计入。"
      : "经历已记录；新章节会安静留在角色入口。",
  );
}
function setScenario(name) {
  const previousCharacter = state.character;
  state = initial();
  state.character = previousCharacter || "zhiwei";
  state.mode = "gentle";
  progress().read = [0];
  if (name === "first") {
    state = initial();
  } else if (name === "acquaintance" || name === "reward-error") {
    seedLedger(2, 1);
    state.day = "2026-11-05";
  } else if (name === "together") {
    seedLedger(7, 4);
    progress().read = [0, 1];
  } else if (name === "api-error") {
    progress().read = [0];
    state.answer = "error";
  }
  if (name === "reward-error") state.failReward = true;
  closeDialog();
  render();
  toast(
    "已载入独立演示场景：" +
      {
        first: "初次选择",
        acquaintance: "相识前一步",
        together: "同行前一步",
        "api-error": "问答失败",
        "reward-error": "经历写入失败",
      }[name] +
      "。",
  );
}
function seedLedger(n, days) {
  for (let i = 0; i < n; i++) {
    const day = "2026-11-0" + (1 + (i % days)),
      id = "seed-" + i;
    state.ledger.push({
      id,
      day,
      kind: i === 0 ? "revision" : "complete",
      milestone: true,
      role: state.character,
      objectId: id,
    });
    state.cards.push({
      id,
      day,
      kind: i === 0 ? "revision" : "complete",
      role: state.character,
      text: i === 0 ? "复盘并修订一份笔记" : "完成一份资料整理",
    });
  }
}
function guide() {
  setDialog(
    "v0.7 原型走查",
    "只验证交互与状态；不连接模型、生产文档或系统钥匙串。",
    '<p>主流程：选择同伴 → 相遇短章 → 确认工作 → 经历 → 新章节 → 形象与CG → 重看与数据控制。</p><div class="flow-map">' +
      [
        "S01 书房侧栏",
        "S02 角色选择",
        "S03 确认经历",
        "S04 成长手札",
        "S05 故事阅读",
        "S06 CG相册",
        "S07 偏好与数据",
      ]
        .map((t) => "<span>" + t + "</span>")
        .join("") +
      '</div><div class="scenario-grid">' +
      [
        [
          "first",
          "从初次选择开始",
          "选择任一角色和陪伴强度，阅读或跳过相遇短章。",
        ],
        [
          "acquaintance",
          "距离相识，还差一次经历",
          "已有2条/1日；确认本次完成后达到3条/2日。",
        ],
        [
          "together",
          "距离同行，还差一次经历",
          "已有7条/4日且有复盘；再确认一次，打开带选择的同行章节。",
        ],
        ["api-error", "问答超时", "看到明确错误，文档保留；重试不发放成长。"],
        [
          "reward-error",
          "工作成功，经历失败",
          "确认经历后显示待保存，重试同一事件只计一次。",
        ],
      ]
        .map(
          ([id, title, desc]) =>
            '<button data-action="scenario" data-scenario="' +
            id +
            '"><strong>' +
            title +
            "</strong><small>" +
            desc +
            "</small></button>",
        )
        .join("") +
      '</div><div class="callout warning">演示场景切换会替换本原型的临时数据。它们不代表产品实际经历，也不能解锁生产角色。顶部重置可恢复初始状态。</div><p class="microcopy">角色与CG均为可辨认的构图示意，不是最终美术资产。工具栏格式按钮为示意；支持的交互集中在角色、经历、故事、问答示例与数据控制。</p>',
    '<button class="primary" data-action="close">开始走查</button>',
  );
}
function sources() {
  setDialog(
    "演示资料与证据",
    "以下内容为固定合成事实，不涉及你的真实空间。",
    '<div class="source-card"><strong>S1 · 阅读活动方案.md · 第4–8行</strong><p>甲方案：周二，120人。乙方案：周四，80人。</p><p>没有满意度、成本或长期效果数据；角色台词、故事与偏好不能补齐这些证据。</p></div><div class="callout">知识回答区域使用相同的Markdown事实、表格与引用；选择角色不会改变内容。原型无任何网络模型调用。</div>',
    '<button class="secondary" data-action="close">返回问答</button>',
  );
}
function clearCompanion(resetAll = false) {
  setDialog(
    resetAll ? "重置这份演示？" : "清空角色演示数据？",
    "仅影响此浏览器中本原型的独立数据，不操作生产 Inkstone。",
    '<p>将清除角色、经历、偏好、故事选择与解锁演示。工作文档和生产数据保持独立。</p><p class="microcopy">这一步不删除任何本机文件。正式产品需在确认后执行角色数据事务，并检查缓存与派生记忆。</p>',
    '<button data-action="close">保留数据</button><button class="danger" data-action="' +
      (resetAll ? "reset-confirm" : "clear-confirm") +
      '">确认清空演示数据</button>',
  );
}
function exportData() {
  const data = {
    prototype: true,
    version: "0.7-design-1",
    character: state.character,
    mode: state.mode,
    reduced: state.reduced,
    ledger: state.ledger,
    cards: state.cards,
    preferences: state.preferences,
    roles: state.roles,
  };
  setDialog(
    "查看与导出角色演示数据",
    "仅包含你在本原型输入的内容；没有生产文档、凭据或模型会话。",
    '<label for="export-data" class="microcopy">导出内容预览</label><textarea id="export-data" class="export-area" readonly>' +
      esc(JSON.stringify(data, null, 2)) +
      "</textarea>",
    '<button data-action="close">返回</button><button class="primary" data-action="download-data">保存演示 JSON</button>',
  );
}
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  switch (action) {
    case "close":
      closeDialog();
      break;
    case "choose":
      choose();
      break;
    case "select-role":
      selectedRole = button.dataset.id;
      selectedMode =
        $('input[name="choose-mode"]:checked')?.value || selectedMode;
      renderChoice();
      break;
    case "apply-role":
      state.character = selectedRole;
      state.mode =
        $('input[name="choose-mode"]:checked')?.value || selectedMode;
      state.enabled = true;
      progress();
      renderCompanion();
      persist();
      if (!progress().read.includes(0)) story(0);
      else {
        closeDialog();
        toast(
          "已切换到" +
            roles[state.character].name +
            "，工作履历共享，剧情分别保留。",
        );
      }
      break;
    case "disable":
      state.enabled = false;
      renderCompanion();
      persist();
      toast("陪伴已关闭；文档、问答与已得进度保留。");
      break;
    case "enable":
      state.enabled = true;
      renderCompanion();
      persist();
      if (!state.character) choose();
      break;
    case "companion-entry":
      state.character ? panel("settings") : choose();
      break;
    case "panel":
      panel(button.dataset.tab || "growth");
      break;
    case "story":
      story(Number(button.dataset.stage));
      break;
    case "story-choice":
      if (progress().choice === null) {
        progress().choice = Number(button.dataset.index);
        persist();
        story(2);
      }
      break;
    case "finish-story":
      finishStory(false);
      break;
    case "skip-story":
      finishStory(true);
      break;
    case "confirm-work":
      confirmWork();
      break;
    case "submit-event":
      addEvent();
      break;
    case "retry-reward":
      commitPending();
      break;
    case "scenario":
      setScenario(button.dataset.scenario);
      break;
    case "reset":
      clearCompanion(true);
      break;
    case "clear-companion":
      clearCompanion(false);
      break;
    case "reset-confirm":
      state = initial();
      closeDialog();
      render();
      toast("演示已重置。");
      break;
    case "clear-confirm":
      state = {
        ...initial(),
        activeDoc: state.activeDoc,
        note: state.note,
        saved: state.saved,
      };
      closeDialog();
      render();
      toast("角色演示数据已清空，演示工作笔记保留。");
      break;
    case "guide":
      guide();
      break;
    case "cg": {
      const stage = Number(button.dataset.stage);
      if (!progress().read.includes(stage)) {
        toast("尚未解锁；达到条件后阅读或明确跳过对应章节。");
        return;
      }
      const r = roles[state.character];
      setDialog(
        r.cg[stage - 1],
        r.name + " · " + stages[stage] + " · CG构图示意，最终插画尚未制作",
        '<figure class="story-scene"><div class="cg-large">' +
          art(state.character, stage, true) +
          '</div><figcaption>第一人称阅读视角；不绘制可识别用户面孔。纸页、书签和文字均为虚构。</figcaption></figure><p class="album-caption">' +
          (stage === 1
            ? "第一张CG强调为另一位读者留下位置，物件与稳定角色辨识共同构成叙事。"
            : "第二张CG强调共同阅读与判断；选择改变措辞和局部配饰，之后回到同一主线。") +
          "</p>",
        '<button data-action="panel" data-tab="album" class="secondary">返回相册</button><button class="primary" data-action="story" data-stage="' +
          stage +
          '">重看对应故事</button>',
      );
      break;
    }
    case "edit-card": {
      const card = state.cards.find((c) => c.id === button.dataset.id);
      setDialog(
        "修改经历卡",
        "仅修改你同意保留的文字，不重复计入成长。",
        '<label for="card-text" class="microcopy">经历内容</label><textarea id="card-text" class="export-area" maxlength="140">' +
          esc(card.text) +
          "</textarea>",
        '<button data-action="panel" data-tab="experiences">取消</button><button class="primary" data-action="save-card" data-id="' +
          card.id +
          '">保存修改</button>',
      );
      break;
    }
    case "save-card": {
      const card = state.cards.find((c) => c.id === button.dataset.id),
        value = $("#card-text").value.trim();
      if (!value) {
        toast("请填写经历内容，或回到列表删除卡片。");
        return;
      }
      card.text = value;
      persist();
      panel("experiences");
      break;
    }
    case "delete-card":
      state.cards = state.cards.filter((c) => c.id !== button.dataset.id);
      persist();
      panel("experiences");
      toast("卡片文字与来源已删除，已获形象保留。");
      break;
    case "edit-pref": {
      const pref = state.preferences.find((p) => p.id === button.dataset.id);
      setDialog(
        "修改已确认偏好",
        "当前归属：" +
          preferenceScopeLabel(pref) +
          "。保留范围会保留原归属；更改范围才重新绑定。",
        '<label for="pref-text" class="microcopy">偏好内容</label><textarea id="pref-text" class="export-area" maxlength="100">' +
          esc(pref.text) +
          '</textarea><label for="pref-scope" class="microcopy">作用范围</label><select id="pref-scope">' +
          ["全局", "当前空间", "当前角色"]
            .map(
              (s) =>
                "<option " +
                (pref.scope === s ? "selected" : "") +
                ">" +
                s +
                "</option>",
            )
            .join("") +
          "</select>",
        '<button data-action="panel" data-tab="settings">取消</button><button class="primary" data-action="save-pref" data-id="' +
          pref.id +
          '">保存修改</button>',
      );
      break;
    }
    case "save-pref": {
      const pref = state.preferences.find((p) => p.id === button.dataset.id),
        value = $("#pref-text").value.trim();
      if (!value) return toast("请填写偏好内容。");
      pref.text = value;
      const newScope = $("#pref-scope").value;
      if (pref.scope !== newScope || !pref.scopeId)
        pref.scopeId = preferenceScopeId(newScope);
      pref.scope = newScope;
      persist();
      panel("settings");
      break;
    }
    case "toggle-pref": {
      const pref = state.preferences.find((p) => p.id === button.dataset.id);
      pref.enabled = !pref.enabled;
      persist();
      panel("settings");
      break;
    }
    case "delete-pref":
      state.preferences = state.preferences.filter(
        (p) => p.id !== button.dataset.id,
      );
      persist();
      panel("settings");
      toast("偏好已删除；此原型无派生摘要或模型缓存。");
      break;
    case "export":
      exportData();
      break;
    case "download-data": {
      const blob = new Blob([$("#export-data").value], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "inkstone-v07-prototype-data.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("已导出演示 JSON。");
      break;
    }
    case "sample-question":
      $("#question").value = "比较两种阅读活动的参与人数，并列出资料不足的部分";
      $("#question").focus();
      break;
    case "retry-answer":
      state.answer = "answer";
      state.tab = "ask";
      renderKnowledge();
      persist();
      toast("固定示例已恢复，没有新增经历或模型请求。");
      break;
    case "sources":
      sources();
      break;
    case "ask-tab":
      state.tab = "ask";
      renderKnowledge();
      persist();
      break;
    case "search-tab":
      state.tab = "search";
      renderKnowledge();
      persist();
      break;
    case "source":
      state.editorMode = "source";
      renderDoc();
      persist();
      break;
    case "body":
      state.editorMode = "body";
      renderDoc();
      persist();
      break;
    case "save":
      state.saved = true;
      persist();
      $("#save-status").textContent = "已保存 · 演示文档";
      toast("演示笔记已保存；普通保存不会自动发放经历。");
      break;
    case "open-doc":
      state.activeDoc = button.dataset.id;
      renderDoc();
      persist();
      break;
    case "sidebar":
      $("#sidebar").classList.toggle("hidden");
      break;
    case "calendar":
      setDialog(
        "日历与角色保持分开",
        "角色不擅自添加系统提醒。",
        '<p>v0.7沿用现有文档日程与日历能力；此原型不复制生产日历编辑器。</p><div class="callout">成长记录使用发生时确定的日期与时区，不依赖签到、连续天数或日历事件数量。</div>',
        '<button class="secondary" data-action="close">回到工作</button>',
      );
      break;
    case "home":
      closeDialog();
      renderDoc();
      toast("回到演示文档。");
      break;
    case "demo-tool":
      toast("格式工具栏为沿用现有编辑器的视觉示意；本原型重点验证陪伴流程。");
      break;
  }
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.id === "setting-mode") {
    state.mode = el.value;
    renderCompanion();
    persist();
  }
  if (el.id === "setting-outfit") {
    state.outfits[state.character] = Number(el.value);
    renderCompanion();
    persist();
  }
  if (el.id === "setting-enabled") {
    state.enabled = el.checked;
    renderCompanion();
    persist();
    toast(
      state.enabled
        ? "陪伴已开启，不补记关闭期间的工作。"
        : "陪伴已关闭；工作功能不受影响。",
    );
  }
  if (el.id === "setting-reduced") {
    state.reduced = el.checked;
    renderCompanion();
    persist();
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "document-search") renderList();
  if (event.target.id === "demo-note") {
    state.note = event.target.textContent;
    state.saved = false;
    $("#save-status").textContent = "有未保存的演示修改";
  }
});
document.addEventListener("submit", (event) => {
  if (event.target.id === "ask-form") {
    event.preventDefault();
    if (!$("#question").value.trim()) {
      toast("请先输入问题，或使用示例问题。");
      return;
    }
    state.answer = "answer";
    state.tab = "ask";
    renderKnowledge();
    persist();
  }
  if (event.target.id === "memory-form") {
    event.preventDefault();
    const text = $("#memory-text").value.trim();
    if (!text) return;
    state.preferences.push({
      id: "pref-" + Date.now(),
      text,
      scope: $("#memory-scope").value,
      scopeId: preferenceScopeId($("#memory-scope").value),
      enabled: true,
      source: "用户手动确认",
    });
    persist();
    panel("settings");
    toast("偏好已确认；作用范围可修改、停用或删除。");
  }
});
$("#modal").addEventListener("close", () => returnFocus?.focus());
render();
