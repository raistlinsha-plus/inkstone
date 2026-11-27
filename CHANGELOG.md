# Changelog

Entries describe implementation milestones. GitHub Releases is the record of public dates, tags and assets. The first public source preview was v0.6.6. [Public release history](https://github.com/raistlinsha-plus/inkstone/releases) · [v0.6.6 notes](docs/PUBLIC-RELEASE-v0.6.6.md)

## v1.2.0-beta.3 · 左侧导航位置（构建 10218）

切换文档、任务和日历时，左侧一级导航图标保持在同一位置。

## v1.2.0-beta.3 · 脑图样式与拖动（构建 10217）

- 从「样式」选择主题后，画布随即显示所选配色，保存并重新打开文件后仍然生效。
- 把节点拖到画布空白处可以调整位置，布局随文件保存。拖到另一个节点上可以调整分支层级。

## v1.2.0-beta.3 · 脑图中心标题（构建 10216）

脑图的圆形中心主题现以紧凑的圆角标题块显示，宽度随标题文字调整。已有脑图打开即可看到变化，导出的 SVG 也使用相同外观。

## v1.2.0-beta.3 · 在画布上整理分支（构建 10215）

- 可连续输入多个想法。填写节点名称时，Shift+Enter 保存并接着输入同级，⌘+Enter 保存并接着输入子节点。
- 右键点击节点即可添加子节点或同级节点、改名、调整同级顺序或删除分支。键盘可用 Shift+F10 打开菜单。
- 有子节点的分支可以折叠。展开后恢复全部后代，折叠操作只改变画布视图。

## v1.2.0-beta.3 · 独立脑图画布（构建 10214）

- 双击节点可以就地改名，使用 Tab 或 Enter 添加子节点或同级节点。在 Markdown 和常用 Mermaid 脑图中，拖动分支可更换父节点或调整同级顺序。
- 新增「青竹」「彩色分支」「墨线」三种样式，选择随文件保存。普通笔记继续提供大纲视图，特殊 Mermaid 语法可在源码或分栏中编辑。

Standalone Markdown and supported Mermaid maps now support in-place node editing, drag-to-reorder and drag-to-reparent. Choose Jade, Color branches or Ink and save the theme with the map. [English user manual](docs/USER-MANUAL.en.md)

## v1.2.0-beta.3 · 空间、图片与脑图（构建 10213）

- 「我的空间」进入主区域。文件夹支持逐级浏览、改名、移动和删除空目录。
- 独立图片直接进入查看器。OCR 在本机读取，视觉提问按图保留待保存结果；保存描述后可以检索并引用。
- Mermaid 脑图默认打开画布，使用细曲线和按源码排列的分支。独立 Markdown 脑图支持键盘添加、命名节点。
- 聊天、笔记、任务与日历共用一条任务的排期和完成状态。Wiki 资料选择保留保存入口。

Spaces and folders open in the main pane. Browse photos, review OCR or explicitly send a preview for visual analysis. Mermaid mind maps open on a canvas, and Markdown mind maps support keyboard editing. [中文交付说明](docs/DELIVERY-v1.2.0-beta.3.md) · [English manual](docs/USER-MANUAL.en.md)

## v1.2.0-beta.2 · 控件与编辑可靠性（构建 10212）

- 在「我的空间」中可以搜索、清空并继续输入，就地修改名称。行尾菜单可用方向键操作，靠近窗口底部时向上展开。按 Esc 退出当前操作后，焦点回到原行。
- 导入窗口显示目标空间、文件夹和扫描结果。从 Finder 拖入文件默认导入当前空间根目录。重新加入已有图片可直接打开原来那一份。导出空间或图片附件包时一并保留原图、预览、识别文字和已保存的描述。
- 在任务列表或日历中选「保存并拆解」，会先写回笔记，再把当前任务标题和排期填入问答。保存失败时可以留在原处修改或重试。聊天转任务可在缺少可写笔记时创建默认任务清单。

Space search and inline renaming support keyboard navigation and Chinese text composition. Imports show their destination, and image bundles preserve the original file and its description. Saving a task for AI assistance carries the edited title and schedule into the question draft. [操作与验收说明](docs/DELIVERY-v1.2.0-beta.2.md)

## 本地构建 10211 · 图片、脑图与空间目录

支持直接打开图片、空间内翻图、保留 HEIC/HEIF 原件和导出原图。macOS 生成预览并识别文字，视觉模型描述可保存为可检索文本。新增独立脑图、嵌套文件夹、按文件夹新建和导入资料，以及空间管理中的置顶、归档与恢复。

## v1.2.0-beta.1 · 从聊天到文档任务

Build 10207 brings Markdown tasks to their own workspace and the weekly calendar. Capture a passage from a chat, check the task in its note, or schedule a work session. Document charts share the contextual controls used by diagrams. [English release notes](docs/DELIVERY-v1.2.0-beta.1.en.md) · [中文版本说明](docs/DELIVERY-v1.2.0-beta.1.md)

- macOS 构建 10207 简化数据图表。正文与分栏中的图表使用一条浮动工具栏，可切换图表、数据表与源码，并导出 SVG 或 PNG。
- macOS 构建 10206 修正正文及分栏预览里的 Mermaid 长图裁切，简化图表和脑图边框与工具栏。标题栏拉开了应用名与版本号的间距。Wiki 关闭按钮与标题对齐，资料范围支持全选和按筛选结果批量勾选或清除。
- macOS 构建 10205 调整问答工作台。提问以简洁气泡显示，回答下方可复制、存为文档和重试，「更多回答操作」可查看本轮上下文或从回答创建任务。联网未能核实时集中说明原因。输入框随草稿增长，聚焦时只显示一层边框，添加资料和本轮联网设置都在发送按钮旁。
- macOS 构建 10204 优化任务快速添加和详情。点加号即可输入，回车或点「添加」后可继续录入下一条。详情将状态、排期和保存操作分组，来源文档可直接打开。
- macOS 构建 10203 将任务和日历拆成两个一级入口。任务可直接写入空间的默认 Markdown 笔记，正文显示勾选状态和排期。周历分别展示截止、跟进和执行时段，拖动执行时段可调整排期。左侧一级导航仅显示图标，悬停或键盘聚焦时浮出名称。默认空间改名为「我的文档」，保留原文及已有自定义名称。
- macOS 构建 10202 将问答、向量、重排和 Brave 密钥移至 Inkstone 本机私有配置。旧安装可在每项服务的设置里导入已保存的钥匙串密钥，后续问答直接读取本地配置。

- 从自己的提问或助手的回答选取原话，逐项核对并保存到指定 Markdown。也可主动调用问答模型提取建议。新建、完成、排期与等待跟进都回写所属笔记，可从日历回到原行。
- 简体中文与英文可在设置中即时切换。可以独立设置回答语言，文档、引用、历史消息与任务原话保留用户输入的文字。
- 回答的「本轮上下文」列出各阶段实际发出的请求、最终请求里的来源数量、回答保留及引用的来源。页边同伴可说明当前动作由什么本地事件触发。
- 调整文档问答的原句筛选及追问处理。离线对照、实机试用和真实模型评测各自的结果见[集成候选交付记录](docs/DELIVERY-v1.2.0-beta.1.md)。

## v1.0.0-rc.4 · 换个说法问笔记

- 从「问这篇文档」提问时，可以用自己的说法询问笔记中的事实。开启模型辅助核对后，应用会把模型选中的内容绑定到当前原句，出处可回到原文。
- 一次问多件事时分项核对。能找到出处的部分保留在回答里，缺项写明待核实的内容。星期追问会重新查找对应日期的依据。[交付与验证](docs/DELIVERY-v1.0.0-rc.4.md)

## v1.0.0-rc.3 · 按小问核对原句

- 文档和空间问答在已有证据不足时，可重新阅读获准的候选片段。找到的原句带有来源和行号，复合问题可以分别说明哪些部分有据、哪些仍待核实。
- 「模型与设置 → 问答模型」新增候选原文核对开关。默认关闭。开启后，每轮最多额外请求一次，发送最多 8 段、合计 4,000 个原文字符。
- 新增 22 道合成开发题，对照原有筛选、本轮选句和直接提供标注原句三种结果。[交付与验证](docs/DELIVERY-v1.0.0-rc.3.md)

## v1.0.0-rc.2 · 中文问答与原文核对

- 问到活动在特定条件下是否开放、两种活动的每场时长或哪一天的安排时，检索会结合原句的对象、单位与日期选取证据。
- 有据问答按小问给出引用。检出的片段不足时说明仍待核实的部分，跨来源推算可回到原始数值核对。
- Wiki 生命周期评测逐条核验初建和来源更新后的引用，并用同一问题对比撤权前后的检索结果。[候选版与验证结果](docs/DELIVERY-v1.0.0-rc.2.md)

## v1.0.0-rc.1 · 本地取证与外部工具

- 对中文改述、多个小问及带条件的问题补充检索，按当前资料范围筛选原句。
- Wiki 审阅可对照来源改动前后的引文。撤回文档前预览受影响的主题、已发布版本和待审改动，确认时重新核对。
- 修复正文编辑器刚打开时首字可能被旧内容覆盖的问题，保留外部文档更新与正文/源码切换。
- 文档和问答的操作菜单支持点外关闭。外部工具可通过独立的空间授权，在本机用 CLI 搜索并核对原文。[候选版与验证结果](docs/DELIVERY-v1.0.0-rc.1.md)

## v0.9.6 · 页边的书房同伴

- 桌宠记住停靠的页边与高度。编辑区变窄时收成书签，也能用键盘调整位置。
- 保存文档后可在页边预览并确认一次经历，完成或取消后继续编辑原文。
- 墨团、砚舟和知微各有像素形象、问候和陪读姿势。文档问答就绪时同伴短暂抬头，故事里的信物随成长呈现在页边。[版本说明](docs/DELIVERY-v0.9.6.md)

从上一公开标签 v0.9.3 更新时，同时包含下列 v0.9.4 和 v0.9.5 的改动。[产品与功能](docs/PRODUCT.md) · [操作手册](docs/USER-MANUAL.zh-CN.md) · [4A 架构](docs/ARCHITECTURE-4A.md) · [技术栈](docs/TECH-STACK.md)

## v0.9.5 · 首次使用与日常书写

- 重复导入后可打开已有副本。逐个选取的文件部分失败后，可单独重试失败项。
- 打开引用核对后可返回原来的编辑位置，保存回答后也可以继续编辑原文。问答输入框区分拼音确认和发送，收起侧栏会将焦点还给编辑器。[版本说明](docs/DELIVERY-v0.9.5.md)

## v0.9.4 · 核对 Wiki 的每一项变化

- 审阅和阅读 Wiki 时可以逐条打开来源原句，核对单方记载、不同取值与缺少依据的结论。
- 来源变化后可从仍获授权的摘录另开当前文档。只发布摘录后，再次整理同一主题会继续更新原页面。[版本说明](docs/DELIVERY-v0.9.4.md)

## v0.9.3 · 工作区字体与文档问答

- 空间首页、日历和文档标题沿用文档库的系统无衬线字体。编辑与阅读共用标题层级，源码和行内代码保持等宽。
- 正文格式栏在窄窗保持单行。修复标题菜单从其他面板打开时的键盘焦点，并调整块拖动手柄、选区和行内代码的呈现。
- 文档问答共用一行顶栏，输入框随草稿伸缩。侧栏支持拖动和键盘调宽，回答可核对当轮的资料与依据。
- 空间首页跟随深浅色，集中显示空间资料操作。更新后的深色主题覆盖「问这篇文档」按钮和标题菜单。[版本说明](docs/DELIVERY-v0.9.3.md)

## v0.9.2 · Wiki 主题与来源维护

- Wiki 首页并列显示已发布主题和最近变化。待审列表优先显示出处过时或结论冲突的改动，审阅时可查看摘要、大纲与来源变化。
- 有权限继续查看的旧摘录独立呈现，无法作为现行依据或跳转。过时版本只能在仍有已核验原文时部分恢复。 [交付说明](docs/DELIVERY-v0.9.2.md)

## v0.9.1 · 有据问答与 40 道留出题

- 对分别有出处的复合问题、不同文档的说法、短追问和明确日期收紧取证逻辑，减少遗漏和旧日期串入。独立问答使用同一范围内、版本仍可核对的原文承接简短追问。
- 「只用我的资料」限制本轮网页搜索。新增 40 道冻结的中文题，并记录原文覆盖、资料范围与真实回答的各自验收口径。 [交付说明](docs/DELIVERY-v0.9.1.md) · [评测说明](evals/v0.9.1/README.md)

## v0.9.0-beta.2 · 首次使用

- 首页提供「用示例体验」和「导入我的资料」。独立的离线空间可查找原文、核对模拟回答并保存带版本引用的示例。
- 「问这篇文档」将问题限定到当前文档。第一次发送可连接问答模型，保存设置后返回原问题和资料选择。 [交付说明](docs/DELIVERY-v0.9.0-beta.2.md)

## v0.9.0-beta.1 · macOS 公证流程与源码预览

- 增加 Developer ID 签名、公证提交、票据附加和最终 ZIP 复验流程。生成可独立校验的发布回执和 SHA-256 校验文件。
- 补充干净 Mac 的首次安装、离线启动、升级和回退验收步骤。GitHub 本版提供源码，Apple 公证与签名安装包发布仍待验收。 [交付说明](docs/DELIVERY-v0.9.0-beta.1.md) · [macOS 发布手册](docs/MACOS_RELEASE.md)

## v0.8.7 · Wiki 增量审阅与回答来源追溯

- 审阅 Wiki 提案时，按提案的基线查看新增、更新和移除的来源，以及摘要和大纲的变化。处理一项后可继续审阅下一项。
- 保存回答时，受管理文档的引用保留来源身份、行范围和内容版本。从保存后的 Markdown 打开引用时核对当前原文。 [交付说明](docs/DELIVERY-v0.8.7.md)

## v0.8.6 · 有据问答

- 指定本地资料时严格保留原范围，避免证据不足时用网页结果代替；独立的通用问答仍能直接回答或按授权搜索。
- 回答明确展示资料类型和核实状态；需要核对的结论可直接打开对应来源。
- 固定的 Brave Search API 与网页取证使用独立网络策略。新增留出题集，分别评估资料、回答和引用。[交付说明](docs/DELIVERY-v0.8.6.md)

## v0.8.5 · 首次使用与本机升级

- 在文档空间体验离线样例、关键词搜索和原文定位。问答入口说明模型配置与本轮资料的使用流程。
- 提取编辑器视图恢复逻辑，容错处理损坏的本机视图偏好，并防止跨文档继承编辑位置。
- 固化本机升级预检、资料快照、原位替换和回退，集中执行项目文档同步与重新打开检查。[交付说明](docs/DELIVERY-v0.8.5.md)

## v0.8.4 · 浅色和深色配色

- 调整工作区背景、正文、侧栏和浮层，统一问答、搜索、设置、导入及文档菜单的主题。恢复资料范围按钮、菜单项和必要提示的可读性。
- 调整日历日期、工具栏和书房同伴的文字对比度，补齐键盘焦点、悬停、选中和错误状态。
- 源码语法、脑图、Mermaid 和 ECharts 预览跟随应用主题。图表预览用线型、点型和纹理辅助识别，SVG/PNG 沿用浅色导出。[交付说明](docs/DELIVERY-v0.8.4.md)

## v0.8.3 · 书房同伴

- 新增书房同伴工作区，整合桌宠、第一季故事、相册和既有经历。
- 墨团支持工作区内低频互动，故事逐句续读并解锁或回看 CG。[交付说明](docs/DELIVERY-v0.8.3.md)

## v0.8.2 · 文档与 Wiki

- 调整编辑器工具栏、结构块间距与工作台外观。
- Wiki 增加资料筛选、审阅与发布状态，并修复窄窗原文跳转。[交付说明](docs/DELIVERY-v0.8.2.md)

## v0.8.1 · 问答工作台

- 左侧导航随工作区切换会话列表与空间文档。
- 区分当轮资料、网页搜索设置和实际引用。支持在问答与原文之间往返，并恢复原会话。[交付说明](docs/DELIVERY-v0.8.1.md)

## v0.8.0 · 问答与 Wiki 发布收口

- 统一版本号与升级说明。独立问答在缺证时引导补充资料或检查索引，网页禁用提示区分公开搜索和模型服务。
- 整理正式发布前的真实服务、独立评测、原生无障碍、升级回退和安装包验收条件。[交付说明](docs/DELIVERY-v0.8.0.md)

## v0.8.0-rc.2 · 问答漏证与 Wiki 审阅

- 改进本地问答的原文证据选择。开发回归继续分别记录必需文档命中、片段覆盖与无答案题误入证。
- Wiki 审阅标出待核对的摘要结论，发布端复核引文，支持仅发布核验过的原文摘录。
- 区分上一次整理结果与当前待审数量。[候选交付和验收](docs/DELIVERY-v0.8.0-rc2.md)

## v0.8.0-rc.1 · 问答证据与 Wiki 整理

- 在有来源的回答中标记可识别的引用冲突和待核对结论。保留原文入口，复制与保存回答时附带核对状态。
- Wiki 修订记录所有模型输入。删除资料或撤回授权时清除关联派生内容。旧 Wiki 生成内容需重新整理，原始文档与授权范围保留。
- 压缩问答资料选择和来源面板，改善 Wiki 待审阅与资料覆盖反馈，保护新建会话时正在保存的草稿。
- 升级 SQLite 并加强备份校验。图表、日历和文档导出的目标位置由原生保存面板返回。
- 冻结已有检索门槛，并增加 64 道开发回归题。[候选交付与验证状态](docs/DELIVERY-v0.8.0-rc1.md)

## v0.7.8 · 墨团动效试点

- 墨团加入像素水墨形象、待机／陪读／里程碑表情和短动效，并随原有阶段装束变化。专注模式和减少动态设置采用静态呈现。
- 相识阶段新增纪念 CG，沿用原来的成长和解锁记录。[本版交付](docs/DELIVERY-v0.7.8.md) · [三版交付导航](docs/DELIVERY-INDEX-v0.7.8.md)

## v0.7.7 · 问答体验与首次使用

- 浏览空间时先核对可选文档，显式选择整个空间或具体文档。问答显示当前阶段，停止操作可防重复点击，重试保留下一问草稿。
- 首次使用可直达问答输入框。Wiki 提供范围、整理、审阅步骤与原文入口，发布后打开生效页面。[本版交付](docs/DELIVERY-v0.7.7.md)

## v0.7.6 · 原文证据选择

- 分别核验独立分问，明确按文档归因保留冲突来源。已发布 Wiki 的部分确切别名可定位有属性和值支撑的原文。
- 增加冻结预留题，分别记录候选和上下文覆盖，并检查过期、越界与无依据结果。[本版交付](docs/DELIVERY-v0.7.6.md)

## v0.7.5 · 联网诊断与检索基线

- 在自动联网设置中增加显式连接测试，区分搜索接口不可用、凭据或额度问题，以及搜索成功但网页正文不可读。测试使用固定公开查询，可在保存新密钥前运行。
- 问答区分搜索失败、没有返回候选和网页无法读取，查阅路径使用中文说明。
- 增加固定合成语料，在相同问题上比较本地关键词检索和 Wiki 辅助召回，分别记录原文覆盖、错误候选和检索耗时。
- [本版交付与验收边界](docs/DELIVERY-v0.7.5.md)。

## v0.7.4 · 本机可靠性更新

- 随问答草稿保存资料范围、分支位置和本轮网页搜索限制。提交成功后为下一轮重新选择范围，重新生成继续使用原轮次的权限和资料。
- 区分翻译、改写等文本处理和时效核查。保留自动联网模式，新增「本轮不搜索网页」，后端在联网规划前执行。
- 独立问答引用按保存时的原文哈希和行号定位。Wiki 引用绑定已显示版本。
- Wiki 支持拒绝后在相同资料范围重新生成，处理原文空行引用。永久删除文档时清理相关 Wiki 派生内容。
- [本版交付与验收边界](docs/DELIVERY-v0.7.4.md)。

## v0.7.3 · 通用问答源码预览

- 新增独立 AI 问答工作台。支持直接聊天、写作、翻译和解释，独立会话与文档空间会话分开保留。
- 每轮可选一个受管理空间、其中最多 5 篇文档，以及最多 5 份 UTF-8 TXT、Markdown、JSON 或 MMD 附件。附件是本机会话副本，单文件上限 2 MiB。
- 合并可用的本地与公开网页证据，显示查阅路径、来源和未读范围。来源选择随本轮保存，问答内容通过明确操作保存为文档。
- 会话库 schema 3 增加附件与每轮来源选择，备份验证覆盖新旧会话格式。[本版交付](docs/DELIVERY-v0.7.3.md)

## v0.7.2 · 知识 Wiki 与自动联网源码预览

- 在受管理空间明确授权可用文档，建立带原文定位的知识 Wiki。提供范围、增量整理、草稿审阅和版本恢复；启用自动维护后只自动发布符合规则的常规整理。
- 将 Wiki 主题和章节用于原文召回，与本地 BM25、可选向量融合。保留候选重排与原文证据核验的独立门槛。
- 新增可关闭的 Brave Search BYOK。启用后模型按当前问题提出查询，应用校验查询及网页访问范围。回答可引用已读取的公开正文，历史保留网页出处元数据。真实 Brave 帐号端到端调用未验收。
- 备份可纳入 Wiki 页面、来源和审阅记录。[本版交付](docs/DELIVERY-v0.7.2.md)

## v0.7.1 · 2026-11-07 · 本机交付

- 新增可操作的首次使用引导，连接复制导入、本地索引、聊天模型、首问、来源核对和回答保存。
- 问答独立管理空间与全局的受控表达偏好，支持启停、删除、本轮停用及显式迁移旧偏好。
- 可预览并选取一条历史用户问题作为本轮背景。在模型调用前验证空间、文档范围、活动分支和摘要。回答保留轻量的本轮上下文记录。
- 同伴可选显示当前空间和角色近 30 天的已确认经历，手札支持角色、日期筛选和来源状态。会话库升级到 schema 2，兼容旧备份。
- [本机交付与回归记录](docs/DELIVERY-v0.7.1.md)。

## v0.7.0-rc.5 · 2026-11-07 · Local stability candidate

- Save the next question to its conversation while the current answer generates. Restore saved drafts after interruption and keep unsent text when regenerating an existing answer.
- Honor stop requests received while saving the submitted question, before starting the model request.
- Move document save and recovery draft handling into a dedicated hook. Keep the existing editor and workspace interfaces.
- Use a documentation check for eligible PRs. Run complete macOS verification on main, and reuse Cargo caches saved from main. See the [candidate delivery record](docs/DELIVERY-v0.7-rc5.md).
- Update zstd to 0.13.4 and zstd-safe to 7.4.0. Add version-pinned license texts for sqlite-vec, jieba-macros and the Apple Silicon Rolldown binding.

## v0.7.0-rc.4 · 2026-11-07 · Stable-scope candidate

- Prepare the next source-preview update: bilingual task-focused README, fictional Quickstart examples, fresh synthetic UI media, release/PR copy and a discoverability plan. Replace the credential test’s timing assumption with explicit worker completion and control the history-search test’s debounce clock while preserving its 200-row pagination/archive assertions; expand current public-doc checks and correct release-manifest catalog metadata to schema4. [Readiness review](docs/GITHUB-READINESS-v0.7.md). No remote publication in this preparation.

- Local deployment maintenance: consolidate daily launch at `/Applications/Inkstone.app`, unregister/remove duplicate application bundles and historical generated caches while retaining source and data backups. [Installation and cleanup record](docs/LOCAL-INSTALLATION.md). Application version unchanged.

- Default to stable natural-name document ordering, with an explicit Recent view, pinned groups, per-space durable preferences and list scroll anchors. Reading no longer influences equal-timestamp ordering.
- Add read-only trash details, explicit restore, and single-document permanent deletion with preview/confirmation, durable staging, rollback before commitment, resumable cleanup and source invalidation. External originals, prior conversations, confirmed experience text and user backups remain separate.
- Migrate the catalog to schema4 with a consistent pre-migration catalog snapshot; retain index schema3 and backup format2. Refuse backups of unfinished deletion state and reject late saves/drafts against unavailable managed documents.
- Align New/Import button icons and labels, refine Q&A scope/header density, keep compact companion actions accessible, and withdraw the ineffective nickname setting while preserving saved values.
- [Implementation, verification and release gates](docs/DELIVERY-v0.7-rc4.md). Not a stable GitHub release.

## v0.7.0-rc.3 · 2026-11-06 · Local candidate

- Narrow windows use a two-pane knowledge task layout and return to editing without overwriting pane preferences. Display the running version in the title bar.
- Compact bounded mindmap/Mermaid canvases with expansion, left-aligned JSON forms and consistent error spacing.
- Retain stopped nonempty responses as explicitly incomplete candidates after current-source checks; include them in validated snapshots.
- Export the current branch/selected answers or all branches/candidates explicitly; JSON remains a full export.
- Review and acceptance limits: [rc.3 delivery](docs/DELIVERY-v0.7-rc3.md), [review and stable-version decision](docs/REVIEW-v0.7-rc3.md).

## v0.7.0-rc.2 · 2026-11-05 · Local candidate

- Flush assistant drafts before navigation and exit; retain input until durable acceptance, preserve failed writes for retry, and serialize generation/draft revisions.
- Retain experience-card edits on save failure; query and paginate conversation history on the backend.
- Resolve explicitly named/fixed-document first questions before missing-context clarification while retaining evidence checks.
- Align title length and frozen-scope readiness; repair the official calendar example.
- [rc.2 implementation milestone](docs/DELIVERY-v0.7-rc2.md). No separate app bundle or GitHub release was created for this intermediate milestone.

## v0.7.0-rc.1 · 2026-11-05

生产候选新增独立持久会话、多轮追问、问题分支/候选、来源快照、草稿与历史管理，展开阅读与安全回答落地；当前追问属性独立门控，历史词项不稀释新缺项。三角色三阶段、九章、经历/偏好/数据控制与15张静态候选插画接入。备份format2纳入会话和角色库并兼容旧格式；catalog/index仍schema3。完整门槛前端260、Rust164/6忽略，三题真实服务冒烟2次HTTP200，五次隔离冷启动通过；本机界面补验因锁屏待完成，详见[候选交付](docs/DELIVERY-v0.7.md)。自然多日试用、动画/像素整理及正式发行门槛仍待后续。


## 0.6.6 · 2026-11-03

- Keep startup loading through workspace/list/session restoration; distinguish failure from an empty library, support retry, and remember pane visibility. Restore dialog trigger focus even when child inputs auto-focus.
- Patch pulldown-cmark 0.13.5 → 0.13.6 for RUSTSEC-2026-0433; the application does not enable the affected Wikilinks option.
- Check explicitly named comparisons per document and shared attribute; preserve lexical/numeric constraints and reject heading-only evidence.
- Freeze synthetic checks, preserve first citation/presentation failures and retests, and add cumulative paid-evaluation reservation and interruption protection.
- Add public Chinese/English guides, architecture summary, synthetic demos and source-release preparation. Supplement eight missing notices from immutable upstream sources; twenty standalone-text gaps remain.

## 0.6.5 · 2026-11-02

- Prevent rerank relevance from granting unsupported evidence eligibility; share ranking and whole-source context limits between application and evaluation.
- Preserve failed real-service evaluations and new-corpus limitations.
- Update ZIP to 9.0.5 and Vitest to 4.1.12; use official npm lockfile URLs. Prepare clean source export, CI and repository templates.

## 0.6.4 · 2026-11-02

- Refine editor toolbar, list alignment, selection round trips, component spacing and narrow dual-pane layout.
- Add IME event/229 protections and keyboard/menu focus regressions; native candidate testing remains separate.

## 0.6.3 · 2026-11-01

- Extract display, typed IPC and parser-worker boundaries. Add scoped/full verification distinction, checked cache reuse, timing and isolated desktop builds.

## 0.6.1–0.6.2 · 2026-10-31

- Add recovery diagnostics, cross-batch internal links and independent relinking, pins/type views, per-document index state, complete ZIP backup validation and restore preview.
- 0.6.1 fixes were incorporated into the 0.6.2 local delivery.

## 0.5.1–0.6.0 · 2026-10

- Make document spaces the managed collection unit; support imports from multiple folders, explicit source updates and conflict protection.
- Refine navigation, editor/structured content spacing and knowledge workflows. 0.5.1 was incorporated into 0.6.0.

## 0.5 · 2026-10

- Add Markdown-rich answers, constrained charts and answer-to-document workflows; improve shared content rendering.

## 0.4–0.4.1 · 2026-10

- Add document calendar content and hybrid BM25/vector retrieval with optional reranking; improve editor toolbar, blank-line round trips and mindmap typography.

## 0.2–0.3 · 2026-10

- Add source/visual Markdown editing and structured JSON/Mermaid/mindmap presentation, cursor insertion and copy import.

## 0.1 · 2026-10

- Establish the local macOS text/Markdown editor, local indexing/retrieval and user-configured compatible model APIs.
