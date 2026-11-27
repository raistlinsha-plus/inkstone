# Inkstone desktop guide · v1.2.0-beta.3

[简体中文手册](USER-MANUAL.zh-CN.md) · [Build from source](QUICKSTART.en.md) · [Beta.3 changes](../CHANGELOG.md)

## Images, mind maps and folders

In Documents, open **Create and organize → Open images…**. Choose one or several images in Finder, browse them with **Previous** and **Next**, then use **Add to space** to retain a local copy. For batch imports, choose the image files in **Import documents**. If you add the same original to the space again, Inkstone shows where it is already saved. Choose **Open existing image** to see its saved text and description.

Open a saved image to browse the other images in the same space in name order, zoom in, or export the original. HEIC, HEIF, JPEG, PNG, WebP and GIF files are supported up to 64 MB per original. The preview displays the primary image or a static frame. macOS recognizes text locally on import. Search and Q&A use this text. For a visual description, open **Analyze image**, check the preview and model, and select **Send image**. This sends the preview to the configured chat endpoint. Select **Save description for search** to include the answer in the document. **Generate image** requires a model on that endpoint that supports image generation and returns a Base64 image.

Select a folder before creating a note, nested folder or mind map. Use a document’s menu to move it. A standalone mind map is saved as a portable `.mindmap.md` file and opens on the canvas. Select a node to rename it or add a child or sibling. In **My spaces**, search by name and use **Clear search** to type another query. Use a row’s **⋯** menu to pin, archive or rename the space. **Rename** selects the old name in place. Use the arrow keys and Enter to choose an action, or press Esc to return to the row. Clicking outside dismisses the menu. Restore archived spaces under **Archived**.

**My spaces** opens in the main pane. Open a folder to browse its direct children and use the breadcrumb to return. You can browse archived spaces and restore one to write to it again. In the image viewer, arrow keys move through the space’s images. **View text** separates OCR from saved descriptions. You can leave an image and return to its pending result. Save any description you want to keep before quitting.

## Edit a standalone mind map on the canvas

Open a `.mindmap.md` file or a supported Mermaid `.mmd` diagram that starts with `mindmap`. Double-click a node or select it and press F2 to rename it in place. Press Tab to add a child or Enter to add a sibling. Type the name and press Enter to apply it, or Esc to cancel. Review the branch before confirming deletion.

Drag a topic into empty space to place its whole branch there. Inkstone saves that position with the map. To change the hierarchy, drop the branch in the middle of another topic to make it a child, or near its top or bottom edge to put it before or after. Drag the background to pan. Choose **Auto layout** to clear manual positions, or press ⌘Z to undo the last edit. [Practice with the reading night map](assets/v1.2.0-beta.3/en/reading-night.mmd)

While naming a topic, press Shift+Enter to save and start another sibling. Press ⌘+Enter (Ctrl+Enter on other platforms) to save and start a child. Enter saves just the current name. Esc cancels the unconfirmed entry. The buttons below the name field also let you save and start a sibling or child.

Right-click the topic you want to organize, or select it and press Shift+F10. Choose **Move up** or **Move down** to shift the whole branch by one sibling. With a topic selected, Option+Up or Option+Down also moves its branch. Use the arrow keys to choose a command, Enter to apply it, or Esc to close the menu.

To see the main branches of a large map, click the fold control at the edge of a branch or select it and press ⌘/ (Ctrl+/ on Windows keyboards). Its badge shows how many topics are hidden. Expand it again to see the original branch.

Under **Style**, choose **Jade**, **Color branches** or **Ink**. The theme is stored in the map file and survives saving and reopening. A single top-level H1 can be renamed at the root of a Markdown map. Maps with several top-level branches use the filename as their shared title. Use source view for branches that contain prose or complex Markdown. Mermaid maps with advanced syntax such as icons or directives retain their native preview and can be edited in source or split view. For an ordinary note, open its outline mind map to inspect the document structure.

## Try a note first

Open **My documents → From sources to your first answer → Try the example**. This creates a separate sample space. Its notes contain Chinese text. Search for `阅读活动` (reading activity) and open a result to jump to the original passage. In **Offline chat walkthrough**, choose **Try sample chat**, open a citation and save the sample answer. This exercise uses a prepared answer and works without a model key. Switch back to your own space when you are ready.

## Start writing

Open **My documents** and select a space. A space groups documents from different places on your Mac. Choose **Import documents** and check the destination space and folder before importing. The preview counts notes, standalone images, attachments and skipped items. With duplicate detection on, it also shows how many items already exist in the destination space. Dropping files from Finder into the window starts a new import at the root of the current space. Edits go into the copy. To edit files in place, open **Spaces and files → Open local folder (edit originals)**.

Create a Markdown note with **New document**. Use **Editor** to format text, **Source** to edit Markdown, or **Split** to compare both. The insert menu supports lists, tables, JSON, Mermaid, charts, mind maps and calendars. Hover over a Mermaid diagram or mind map, or Tab to its controls, to zoom, fit or export an SVG. Tall Mermaid diagrams expand with the document. Save with ⌘S. Use a document’s menu to inspect its history or check whether an imported original has changed.

![Document workspace in English](assets/v1.2.0-beta.1/en/workspace.png)

### Work with a data chart

1. Import the [sample note](../examples/v0.6.6/首发体验.md) and open its chart, or use **Insert** to create a data chart in a Markdown note. In **Editor** and **Split**, hover over the chart or Tab to its toolbar.
2. Switch between **Chart**, **Table** and **Source**. Check the category, series and unit before comparing values. An empty cell represents missing data.
3. Choose **Edit chart** to edit the data, then **Apply chart changes** and ⌘S to save the note. Return to **Chart** to export SVG or PNG. **Chart description** opens a text version of the values. To edit a chart in a model response, first save the answer as a document.

## Choose your languages

Open **Models and settings → Language / 语言**. Choose **Use system language**, **简体中文**, or **English**. The setting takes effect immediately. The current calendar and schedule continue to use their own time zones. Imported documents, prompts, citations, Wiki pages and previous answers keep their original text.

New installations match supported languages in the system’s preferred order and fall back to English. Upgrades with existing Inkstone browser preferences retain Simplified Chinese until you choose another language. macOS file pickers and system dialogs follow the system. Provider errors and older saved status messages may appear in their original language.

Open **Answer preferences** to select an answer language for one space or globally. The default follows your question. A request such as “summarize this in English” takes priority. Citations preserve the original passage. A provider’s performance on cross-language retrieval depends on the selected model and available evidence.

## Ask about sources

1. Import a note, open its space and choose **Source index**. Keyword indexing works locally. Add an embedding service in **Models and settings** if you want semantic retrieval.
2. Open the note and choose **Ask about this document**, or use **AI chat → Add sources** and select only the files or space you need. For an ordinary conversation, leave sources empty.
3. Connect your chat provider in **Models and settings** and send your question. Open a citation to read the source and check its version. Choose **More answer actions (…) → Context for this turn** to inspect which services were called, character counts, sources in the final request and citations used. Token counts appear when a service supplies them. Older conversations may have no request record.
4. Use **Save as document** to preview the Markdown and choose its destination. Saving an answer or importing a file never silently changes the external original.

![Answer with citations in the English chat workspace](assets/v1.2.0-beta.1/en/answers.png)

Embedding, reranking, chat and web search can use the providers you configure. Their settings explain what text they receive. To restrict a turn, disable web search or remove sources before sending. Local keyword search is available without an API key.

**Check independent claims.** For “When does the library close, and when does the talk start?”, open the source for each time. If only one is supported, add a relevant note or leave the other item open. For a follow-up, name the event if the previous turn discussed several. Under chat model settings, **Verify candidate passages with the chat model** optionally sends up to eight candidate passages (4,000 source characters) for one additional request per turn when local evidence is insufficient. Turning off public web search controls a separate service.

**Share an answer.** Use the icons below it to copy Markdown or save a note. Use **Regenerate** to retry from the chat workspace. In the document sidebar, it is under **More answer actions (…)**. Enter sends your question, Shift+Enter adds a line, and Enter confirms the current candidate while a Chinese input method is composing.

**Save or migrate a service key.** Enter an API key in the settings for chat, embeddings, reranking or Brave Search and choose **Save**. For an existing installation, select the service at its saved address and choose **Import from old Keychain**. If macOS asks for your login keychain password, **Allow** is sufficient for that read. Import saves the key immediately. Repeat for each service you use. You can also enter the key directly. To retry a failed answer, choose **Regenerate** under the original question.

Inkstone stores these keys in `~/Library/Preferences/local.inkstone.desktop/credentials.json` with owner-only file permissions (`0600`). The file contains the keys in plaintext and can be read by programs running with your account’s permissions. Treat it as private. Normal chat, indexing, Wiki generation and search read the local configuration. The portable space backup omits the keys.

## Track work in Markdown

Hover over a navigation icon or Tab to it to read the label. Use **Tasks** to see tasks across the current space. Click the plus or **Add a task…**, type a title and press Enter or choose **Add**. The field is ready for another task. Tasks captured in **Today** are due today, and tasks captured in **Upcoming** are due tomorrow. Capture a task in **All tasks** to leave its date open.

The first quick capture creates **Tasks.md** in that space unless you select an existing note under **Save to**. Renaming the default note keeps future captures linked to it. The built-in space is **My Documents**. In a note, use **Insert → Task** to add a tracked checklist item. Check it off in the editor or in the task list. **Stop tracking** keeps the ordinary Markdown checklist item.

![Tasks in the English interface](assets/v1.2.0-beta.1/en/tasks.png)

Open **Calendar** in the main navigation to see the week. A due date marks the deadline. A follow-up date marks when you want to check back. Both appear in the all-day area. To reserve time to do the work, open the task, choose **Schedule a time slot**, set start, end and time zone, and save. Drag the block in the week grid to change the schedule while keeping its deadline. Click the task’s source document to return to its line. All three views read the same Markdown task.

![Calendar in the English interface](assets/v1.2.0-beta.1/en/calendar.png)

### Turn a conversation into a task

1. On your own message use **Create tasks from the original message**. For an answer, choose **More answer actions (…) → Create tasks from answer**. Select the sentence that describes the work, then choose **Add selection**.
2. For a long message, **Extract with chat model** can propose actions. By default the request includes the displayed message. When extracting from an answer, select **Include my question in extraction** to send the question too.
3. Review the proposed actions, change their titles or deadlines, choose an active space and a writable Markdown note, then select **Save to note**. If that space has no writable notes, **Task list (created on save)** creates the task note when you confirm. If the note changed during review, reload it and check the destination before saving.
4. Open the task in **Tasks** or **Calendar**, edit the title or scheduled time, and choose **Save and break down with AI**. After the note is saved, the edited title and schedule appear in a question you can review and send. If the save fails, the task details stay open with your edits ready to retry.

## Maintain a Wiki

Open **Knowledge Wiki**, select the documents allowed for compilation and save the scope. To change several sources at once, filter the list and select or clear all matches. Documents outside the filter keep their selection. Compilation sends the selected source material to the configured model. Open **Review and changes** to compare a candidate with the source excerpts. Publish, reject or, where available, publish only the verified excerpts. Published topics link to their sources. Recompile when a source changes. To remove a source, choose **Review items to clear**, inspect the affected topics, revisions and pending changes, then **Confirm save and clear**. The original document stays in its space. Changing the interface language alone does not rewrite a Wiki.

## Read with a companion

Open **Study companion**, select a character, and choose a chapter. Season one offers three chapters for each of Motuan, Yanzhou and Zhiwei. You can change languages mid-chapter and return to the same passage. Choices, unlocked art, confirmed experiences and growth belong to the same local character profile in both languages.

Click the desk pet for its actions or expand the explanation to see why the current pose was chosen. Set **Reduce motion** or enable focus mode for quieter reading. Use the journal to inspect confirmed experiences. Experiences and story dialogue are separate from the sources attached to your questions.

## Use local sources from another tool

In **Models and settings → External tools**, choose one space and create a read-only connection. A local tool can use `inkstone-cli` to search the prepared keyword index and read cited lines from that space. The CLI uses its own revocable connection token. In the source checkout, build it with `cargo build --locked --release --manifest-path src-tauri/Cargo.toml -p inkstone-cli`. Run `src-tauri/target/release/inkstone-cli --help` for its commands. [Pairing and query examples](EXTERNAL-TOOLS.en.md)

## Back up and recover

To share one space, choose **Export space** on the space home page. The ZIP includes each standalone image’s original, preview, recognized text and saved description. To import it into another space, extract the archive, open **Import documents** in the destination and select the extracted folder.

To back up all spaces, open **Spaces and files → Backup and restore rehearsal**. Create a backup, verify its manifest and test restoration in an empty folder. Keep the verified archive separately. Configure service keys separately after restoring to a different Mac. Use the document trash to restore a removed copy or review the impact before permanently deleting it. Use **Recovery and diagnostics** if an import or file operation was interrupted.


## When a result looks wrong

| What you see | What to check |
| --- | --- |
| Search finds a note, but the answer lacks evidence | Open the citations and check the selected scope. For hybrid retrieval, use **View document index** to check that the note has a current index. |
| A Wiki topic misses a conclusion | Review the allowed sources, pending changes and dated excerpts. Add or update a source and compile it again. |
| A task is missing from this week | Open **All tasks**, check its due date, follow-up date, time slot and time zone. Tasks with no dates appear in the task list. |
| A desk pet stays still | Check focus mode and Reduce motion, including the macOS setting. Widen the editor if the pet is docked as a bookmark. |
