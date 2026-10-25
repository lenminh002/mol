---
status: active
created: 2026-10-25
updated: 2026-10-25
tags: [chat, history, sidebar]
related: ["[[sidebar-redesign]]"]
---

## Related
- extends: [[sidebar-redesign]] — adds chat info to the History rows it styled

# Active chat history

1. `db.list_runs` returns `chat_count` and `chat_preview` per run.
2. `HistoryItem` gets the optional fields.
3. History rows in `DrugPanel` mark the active run (`runId`), show message count and last-message preview.
4. `ChatThread` shows an "Active chat" header with count and run label.
5. `usePersistChat` refreshes History after saving so the count/preview stay current.
6. Test: `api/tests/test_db.py`.
