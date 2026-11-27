# Known limitations · v1.2.0-beta.3

## Document Q&A

In the frozen offline keyword replay, the 1.2 beta supplied 21 of 53 annotated answer points to the final context, including 2 of 13 follow-up points. RC.4 supplied 15 of 53. These counts measure the evidence available to the model. A scored live-model comparison on this beta and an independent human review of its answers and citations are still pending. Follow citations to check dates, units and who or what a statement describes. [Beta evaluation](DELIVERY-v1.2.0-beta.1.en.md) · [Frozen replay](../evals/v1.0/rc5/README.md)

## Platform, language and tasks

The source prerelease targets macOS 13 or later on Apple Silicon. A public app download still needs Developer ID signing, Apple notarization, a clean-Mac install test and a binary license review. The local beta.2 build passed native macOS text-composition checks in the editor and space rename field. Additional input methods, manual VoiceOver use and long writing sessions still need testing. Browser tests exercise selected editor and task workflows with fixture data. [Distribution runbook](MACOS_RELEASE.md) · [Public releases](https://github.com/raistlinsha-plus/inkstone/releases)

The interface and the first companion season support English and Simplified Chinese. System dialogs, older messages and provider errors can follow their original language. The beta lacks independent cross-language retrieval measurements. Tasks live in managed Markdown notes. An undated task appears in Tasks; a due date, follow-up date or scheduled work session gives it a place in Calendar. [User manual](USER-MANUAL.en.md)

## Images and mind maps

Opting in to image analysis sends a preview and your question to the configured model. While the app is open, you can switch images and resume a pending result. Save it before quitting to keep it in the searchable image record. GIF and HEIF sequences use their primary or static preview. Supported mind maps use hierarchical layout with optional manual positions. Dragging into empty space stores branch offsets in file comments. Inkstone reads those offsets when the map is reopened. Other Mermaid or Markdown viewers can use their own layout. Edit prose-rich Markdown branches in source view. Mermaid maps with unsupported decorations use Mermaid’s own layout and retain source editing. [User manual](USER-MANUAL.en.md)

## Sources, storage and review

RAG reports document recall, evidence availability, citation/answer review and chart semantics separately. The synthetic cases are authored by the same development agent and are not independent user research. A high recall or rerank score does not establish answer correctness. Keyword evidence remains conservative for paraphrases. Vector-only is an evaluation baseline rather than a user-facing mode; it cannot bypass the BM25 evidence policy. API compatibility and provider billing vary. Missing usage/cost data stays unknown.

The app validates constrained chart data and source identity/hash. Answer checks flag selected numeric, date, unit and negation issues; any other claim still needs source review. An insufficient context budget can skip an oversized source intact to avoid sending a clipped table or negative condition.

The document sidebar supports one space or one document. Standalone chat can select one managed space and up to five documents from it, plus up to five local text attachments per turn. An attachment is a UTF-8 TXT, Markdown, JSON or MMD file up to 2 MiB. A conversation retains up to 12 attachment copies, and the assistant database caps attachment text at 32 MiB across conversations. Long files and entire spaces may only be represented by selected passages. Imported standalone images have local OCR. You can submit a preview to your configured vision model from the image viewer. PDF and DOCX import, attaching an image directly to a general chat turn, background bidirectional sync, multi-user collaboration and cross-space document moves remain future scope.

Wiki compilation is limited to ready documents explicitly authorized in one managed space, with per-batch and daily call limits. Changed source versions can invalidate Wiki summaries or references. Old generated Wiki pages without input provenance need to be rebuilt during the candidate upgrade. Automatic web search needs a separate Brave Search key and reads a bounded number of directly accessible public HTTPS pages. Search abstracts are used for discovery, while citations require retrieved page text. Dynamic or authenticated sites, redirects and unsupported formats may be skipped. [Evaluation and live-service status](../evals/v0.8.6/README.md) · [Wiki and web scope](DELIVERY-v0.7.2.md)

Motuan, Yanzhou and Zhiwei are optional pixel companions in the editor margin. They support docking, compact bookmarks, work milestones, locally animated poses and reduced motion. Stories and CGs open in the companion workspace. A separate macOS desktop overlay remains future scope. A five-day observation of distraction and placement during ordinary writing is pending. [v0.9.6 companion behavior](DELIVERY-v0.9.6.md) Experience cards are not paginated, and timezone changes after a nonempty experience ledger are not supported.

Earlier retrieval evaluations are documented in the [v0.6.6 results](../evals/v0.6.6/RESULTS.md). Binary distribution requires completing the remaining upstream license-text review and macOS distribution checks. [Third-party notices](../THIRD_PARTY_NOTICES.md) · [Roadmap](ROADMAP.md)

## Earlier answer-quality evaluations

In RC.4, both a complete note and a note with missing evidence were used to test each of 20 questions. A blind AI review accepted both answers for 5 of the 20 pairs. Overall, 15 of the 40 answers passed, unchanged from RC.3. Only 2 of 13 partially supported questions passed in RC.4. Open the citations when asking a follow-up or when one part of a question appears unanswered. A separate 52-question replay passed 6 answers in RC.4 and 1 in RC.3. Human review remains pending. [RC.4 results](DELIVERY-v1.0.0-rc.4.md) · [Paired evaluation method](../evals/v1.0/rc4/README.md)

In the final RC.3 independent keyword-mode run, 44 of 46 questions with at least one supported answer received a blanket refusal. An independent AI review marked one of 52 answers fully correct. Human review is pending. The optional passage reader requires explicit opt-in. An exact quotation may still answer a different question. Review the linked passage for its subject, dates and units. [RC.3 evaluation](DELIVERY-v1.0.0-rc.3.md)

The earlier RC.2 development candidate frequently returns insufficient evidence on independently written Chinese questions. In a 52-question keyword-mode run, 49 stopped locally for lack of evidence, one requested clarification, and two reached the chat model. The final offline replay found candidates on all 51 searches, with evidence admitted on two. [RC.2 evaluation and release status](DELIVERY-v1.0.0-rc.2.md)
