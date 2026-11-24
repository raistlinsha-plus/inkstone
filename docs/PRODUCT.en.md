# Inkstone product tour

**English** · [简体中文](PRODUCT.md) · [User manual](USER-MANUAL.en.md)

**v1.2.0-beta.1** runs on Apple Silicon Macs with macOS 13 or later. Inkstone brings together Markdown notes, questions about the source material, and the actions you decide to take. You can write, schedule tasks and search your notes offline. Add your own compatible model to ask questions or compile a project Wiki.

Suppose you promise on Monday to send a draft by Friday. Select the promise in chat, choose the note where it belongs, and set Friday as the due date. Reserve a writing session for Wednesday in Calendar. When Wednesday comes, open the task from the calendar to jump to the checklist line in your note. The interface supports English and Simplified Chinese. You can set the language for new answers independently. [Beta changes and evaluation](DELIVERY-v1.2.0-beta.1.en.md)

## Start with two notes

Import a project plan and a retrospective into one space. Search for a phrase to open the original paragraph. Once you configure your model, ask how many events were planned and how many took place. Follow the citations to compare the plan with the retrospective. Save the answer as a note, return to your writing position, and select either source for the project Wiki when you are ready. [Sample notes and questions in Chinese](../examples/v0.7.3/README.md)

## Choose a workspace

| Workspace | What you can do | Where the result goes |
| --- | --- | --- |
| Documents | Import copies from different folders, find or pin a file, export a space and restore files from the trash. | The space holds an editable local copy. You can compare later changes with the original. |
| Editor | Write Markdown visually, in source or in split view. Insert tables, JSON, Mermaid diagrams, mind maps, calendars and charts. | Content stays in the note. Hover over a chart or focus it with Tab to switch to its data table or export SVG or PNG. |
| Tasks | Quickly add an item, insert one into a note, or select an action from a conversation and confirm it. | Each tracked item has a Markdown checklist line. Its title, completion, deadline and scheduled time are shared across views. |
| Calendar | See work sessions, deadlines and follow-ups in the week view. Drag a session to change when you will work. | Schedule edits go back to the source. Open an item's document link to jump to the line. Document calendar entries also support ICS export. |
| Search and document Q&A | Use keyword search offline or ask about a specific document or space. | Results point to the relevant passage. A saved answer retains the cited excerpt for comparison with the current text. |
| AI chat | Translate, rewrite or ask follow-up questions. Choose source documents or attach local text files for a single turn. | Conversations and source references stay in local history. You can save an answer as Markdown. |
| Knowledge Wiki | Select sources in a space, inspect proposed topics and check conflicting accounts. | Published topics link to their evidence. Reject a proposal or publish only verified excerpts when appropriate. |
| Study companion | Choose an optional page-edge character and decide which completed work to record. | Confirmed experiences, story progress and unlocked artwork stay on your Mac. |

[Document chart](assets/v1.2.0-beta.1/en/workspace.png) · [Task list](assets/v1.2.0-beta.1/en/tasks.png) · [Calendar](assets/v1.2.0-beta.1/en/calendar.png)

## Search, ask or compile a Wiki

- **To find words you remember**, start with local keyword search. If you configure an embedding endpoint and prepare the index, Inkstone can combine keyword and vector results. Reranking is also optional. The result records which retrieval method was used. External tools can get read-only search access to a space with its own authorization. [CLI reference](EXTERNAL-TOOLS.en.md)
- **To answer a question**, choose **Ask about this document**, or use **AI chat** for a separate conversation. Pick up to five documents from one space and attach up to five local text files to a standalone turn. A turn can also use Brave Search if you authorize it. Check the cited lines and the context details before relying on the result, especially for multi-part questions. [Known limits](KNOWN-LIMITATIONS.md)
- **To maintain a topic**, open **Knowledge Wiki → Sources**, filter and select the notes to include, and save the scope. Compile and open **Review and changes**. If two sources differ, check both passages before publishing. Historical excerpts remain available for comparison when a source changes.

## Read with a companion

Choose Motuan, Yanzhou or Zhiwei in **Study companion**. The character docks on either edge of the editor and folds into a bookmark when space is tight. It can react when a document answer is ready. Use focus mode or reduce motion for quieter writing.

After saving a note, you can preview a milestone in the companion menu and confirm what to record. A document can contribute one experience in a day, with up to two across documents per day. The progress view shows what unlocks the next stage. Revisit chapters in the story view and unlocked art in the album. These actions run locally without separate model calls.

## Files, services and backups

A managed space holds copies, so importing notes from different locations preserves the originals. The advanced **Open local folder (edit originals)** mode edits the chosen files in place. Supported imports include Markdown, TXT, JSON and MMD text. [Quickstart](QUICKSTART.en.md) · [Backup and recovery](USER-MANUAL.en.md#back-up-and-recover)

Chat, Wiki compilation, embeddings and reranking send the question, excerpts or source material for the relevant task to your configured providers. Brave receives a public search query when enabled and used. Inkstone keeps service keys in an owner-only local preferences file. Existing installations can import an old Keychain entry per service. Portable backups omit these keys. [Security policy](../SECURITY.md)

GitHub provides the source release and its checksum. Follow the guide to build the desktop app locally. [User manual](USER-MANUAL.en.md) · [Roadmap](ROADMAP.md) · [Changelog](../CHANGELOG.md)
