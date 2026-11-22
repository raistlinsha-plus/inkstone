# Inkstone desktop guide

## Start writing

Open **Documents** and select a space. A space groups documents from different places on your Mac. Choose **Import documents** to copy a file or folder into the active space. Edits go into the copy. To edit files in place, open **Spaces and files → Open local folder (edit originals)**.

Create a Markdown note with **New document**. Use **Editor** to format text, **Source** to edit Markdown, or **Split** to compare both. The insert menu supports lists, tables, JSON, Mermaid, charts, mind maps and calendars. Save with ⌘S. Use a document’s menu to inspect its history or check whether an imported original has changed.

## Choose your languages

Open **Models and settings → Language / 语言**. Choose **Use system language**, **简体中文**, or **English**. The setting takes effect immediately. The current calendar and schedule continue to use their own time zones. Imported documents, prompts, citations, Wiki pages and previous answers keep their original text.

New installations match supported languages in the system’s preferred order and fall back to English. Upgrades with existing Inkstone browser preferences retain Simplified Chinese until you choose another language. macOS file pickers and Keychain notices follow the system. Provider errors and older saved status messages may appear in their original language.

Open **Answer preferences** to select an answer language for one space or globally. The default follows your question. A request such as “summarize this in English” takes priority. Citations preserve the original passage. A provider’s performance on cross-language retrieval depends on the selected model and available evidence.

## Ask about sources

1. Import a note, open its space and choose **Source index**. Keyword indexing works locally. Add an embedding service in **Models and settings** if you want semantic retrieval.
2. Open the note and choose **Ask about this document**, or use **AI chat → Add sources** and select only the files or space you need. For an ordinary conversation, leave sources empty.
3. Connect your chat provider in **Models and settings** and send your question. Open a citation to read the source and check its version. When context details are available, inspect what the turn used.
4. Use **Save as document** to preview the Markdown and choose its destination. Saving an answer or importing a file never silently changes the external original.

Embedding, reranking, chat and web search can use the providers you configure. Their settings explain what text they receive. To restrict a turn, disable web search or remove sources before sending. Local keyword search is available without an API key.

## Track work in Markdown

Open **Tasks & calendar** and choose **Tasks** to see tracked items in the current space. You can also open a document in the editor and use **Insert → Track as task**. A tracked item lives on a Markdown checklist line with its Inkstone metadata. A due date, scheduled work and a follow-up have distinct meanings. After editing a schedule, check the calendar and open the original document from the item.

To turn part of a chat into work, use the task action on your message or on the answer. Review the proposed entries, select the items to keep, edit the text and choose the destination document. Confirm to write them. You can request help on a task and edit the proposed question before sending it.

## Maintain a Wiki

Open **Knowledge Wiki**, select the documents allowed for compilation and save the scope. Compilation sends the selected source material to the configured model. Open **Review and changes** to compare a candidate with the source excerpts. Publish, reject or, where available, publish only the verified excerpts. Published topics link to their sources. Recompile when a source changes. Changing the interface language alone does not rewrite a Wiki.

## Read with a companion

Open **Study companion**, select a character, and choose a chapter. Season one offers three chapters for each of Motuan, Yanzhou and Zhiwei. You can change languages mid-chapter and return to the same passage. Choices, unlocked art, confirmed experiences and growth belong to the same local character profile in both languages.

Click the desk pet for its actions or expand the explanation to see why the current pose was chosen. Set **Reduce motion** or enable focus mode for quieter reading. Use the journal to inspect confirmed experiences. Experiences and story dialogue are separate from the sources attached to your questions.

## Back up and recover

Open **Spaces and files → Backup and restore rehearsal**. Create a backup, verify its manifest and test restoration in an empty folder. Keep the verified archive separately. Cloud API keys remain in macOS Keychain. Use the document trash to restore a removed copy or review the impact before permanently deleting it. Use **Recovery and diagnostics** if an import or file operation was interrupted.
