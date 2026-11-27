# v1.4.0-rc.1 · Use images in chat and save creations to your project

Local build 10222. Add a picture and a meeting note to the same chat turn to check them together. To create an image, open **Create image** beside the composer, use your own service, preview the result and choose a space and folder.

| Local version | Changes |
| --- | --- |
| 1.2.0-rc.1 · 10219 | Fast mind-map drags use the release position. Renaming a space inside search results returns keyboard focus to its row. |
| 1.2.0 · 10220 | Short weekday follow-ups reuse the previous subject and check the current sources. The upgrade backup procedure now rehearses a full restore. A fast OCR fallback handles supported scripts when accurate recognition fails. |
| 1.3.0 · 10221 | Combine an image and a note in one question. Choose local OCR, a saved description or a JPEG preview. Confirm the preview, endpoint and model before transmitting pixels. |
| 1.4.0-rc.1 · 10222 | Generate from chat or the library, inspect the preview, revise the prompt and save to a destination folder. Repeating the save in the same folder reuses the existing item. A different destination gets a separate item. |

Documents stays first in the left navigation. The document list and task filters share a divider you can drag to resize. Use the sidebar button at the top left of the window to hide either list. Each remembers its own setting. Calendar opens at full width.

At window widths of 960 and 1280 pixels in Chinese and English, document and task sidebars both measured 272 pixels wide by default. All seven task filters were available, and the navigation icons held their positions after switching and collapsing the sidebar.


## Verification and support

Native Mac testing covered Chinese composition in long notes, bold formatting across views, quick dragging and 16 navigation states. The restore rehearsal uses a private temporary directory. Image selection and generation support keyboard and pointer input in English and Simplified Chinese.

A live gpt-4.1-mini request read “INKSTONE RESEARCH 2026” from image pixels and “MICA-71” from a separate synthetic note, citing each source correctly. A paired two-question sample checked a follow-up against the same notes on both versions. The trial made six text requests, including a repeated baseline run, and one vision request. The frozen offline replay still covers 21/53 evidence points, including 2/13 follow-up points. Independent human scoring is pending.

Generation was tested with a local provider fixture. Configure your own enabled image generation model to use it. The service must support a compatible images/generations endpoint returning inline Base64 images. The local candidate uses an ad hoc signature. Cross-device trials and public installer signing and notarization remain outstanding.

[English user guide](USER-MANUAL.en.md) · [中文交付记录](DELIVERY-v1.4.0-rc.1.md)
