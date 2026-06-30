# OpenCode Web Orchestrator

Web UI để gửi coding request, hệ thống tự động plan → code → verify → review → retry → báo kết quả, tất cả đều chạy qua OpenCode CLI.

---

![Jobs List](screenshots/01-jobs-list.png)

---

## 1. Cài đặt nhanh (2 phút)

### Yêu cầu
- Node.js 18+, npm, git
- OpenCode CLI: `npm install -g @opencode-ai/cli`
- Đã cấu hình OpenCode provider (ví dụ: `OPENAI_API_KEY`, hoặc Ollama local)

### Clone & install
```bash
git clone https://github.com/thichcode/ai_loop.git
cd ai_loop
npm install
npm run init-opencode
```

## 2. Chạy

### Terminal 1 — API server + Web UI
```bash
set WORKSPACE_ROOT=C:\Users\YourName\repos
npm run dev
```
Mở trình duyệt tại `http://localhost:5173`

### Terminal 2 — Worker (xử lý job)
```bash
set WORKSPACE_ROOT=C:\Users\YourName\repos
npm run worker
```

---

## 3. Dùng thử

### Bước 1: Mở http://localhost:5173 → click **New Job**

### Bước 2: Điền form

![New Job Form](screenshots/02-new-job.png)
| Field | Ví dụ |
|-------|-------|
| Repository Path | `C:\Users\You\repos\my-project` (phải nằm trong `WORKSPACE_ROOT`) |
| Coding Request | `Thêm API GET /users trả về danh sách user từ database` |
| Branch Name (optional) | `feature/users-api` |
| Max Rounds | `3` |
| Planner Model | `openai/gpt-4.1` |
| Coder Model | `ollama/qwen3-coder:9b` |
| Reviewer Model | `openai/gpt-4.1` |

### Bước 3: Click **Run**

![Job Detail](screenshots/03-job-detail.png)

- Live log hiện real-time qua SSE
- Theo dõi task list, trạng thái từng task
- Xem diff từng task khi hoàn thành
- Khi job done → có thể Commit

---

## 4. Kiến trúc

```
Browser ──REST/SSE──► Fastify API ──SQLite──► orchestrator.db
                           ▲
                           │
Worker ──poll queue──► claimNextJob()
  │
  ├── validate repo path (an toàn dưới WORKSPACE_ROOT)
  ├── git status, git switch -c <branch>
  ├── opencode run --agent planner  →  TASKS.md + tasks.json
  │
  └── for each task:
       ├── opencode run --agent coder9b
       ├── npm test (verify command)
       ├── git diff
       ├── opencode run --agent reviewer
       └── retry nếu NEEDS_FIX, tối đa maxRounds
```

---

## 5. Environment Variables

| Variable | Required | Default | Mô tả |
|----------|----------|---------|-------|
| `WORKSPACE_ROOT` | **Có** | — | Thư mục gốc chứa repo được phép dùng |
| `PORT` | Không | `3000` | Cổng API server |
| `DATABASE_PATH` | Không | `.oc-web/orchestrator.db` | File SQLite |
| `COMMAND_TIMEOUT_MS` | Không | `1800000` (30 phút) | Timeout mỗi lệnh |
| `POLL_INTERVAL_MS` | Không | `1000` | Tần suất worker poll queue |

---

## 6. npm scripts

| Script | Mô tả |
|--------|-------|
| `npm run dev` | Chạy API + Vite dev (hot reload) |
| `npm run build` | Build TypeScript + Vite + esbuild |
| `npm run start` | Chạy production server (cần build trước) |
| `npm run worker` | Chạy worker process riêng |
| `npm run init-opencode` | Tạo `.opencode/opencode.json` + agent prompts |
| `npm test` | Chạy 40 test |

---

## 7. Luồng job chi tiết

1. **Queued** → Worker claim → **Validating** (kiểm tra path, tạo `.oc-web/runs/<id>/`)
2. **Git** → `git status`, tạo branch nếu có
3. **Planning** → `opencode run --agent planner` tạo `TASKS.md` và `tasks.json`
4. Với mỗi task:
   - **Coding** → `opencode run --agent coder9b`
   - **Verifying** → chạy command verify từ `tasks.json`
   - **Reviewing** → `opencode run --agent reviewer`
   - Nếu `NEEDS_FIX` → chạy lại coder với feedback, tối đa `maxRounds` lần
5. **Finalizing** → tổng hợp diff, changed files, final summary
6. Kết quả: **done** / **partial** / **failed** / **cancelled**

---

## 8. An toàn

- ✅ Chỉ cho phép repo path dưới `WORKSPACE_ROOT`
- ✅ Không auto-push, không auto-commit (phải bấm Commit)
- ✅ Git status dirty vẫn chạy được, không mất code
- ✅ Diff hiển thị trước khi commit
- ✅ Cancel job được hỗ trợ (kills process đang chạy)
- ✅ Timeout cấu hình được cho mọi lệnh
- ✅ Logs lưu cả DB và file `.oc-web/runs/<id>/log.txt`

---

## 9. Troubleshooting

| Vấn đề | Giải pháp |
|--------|-----------|
| `WORKSPACE_ROOT is required` | Set biến môi trường trước khi chạy |
| `Repository path must be under WORKSPACE_ROOT` | Path repo phải nằm trong thư mục đã chỉ định |
| `opencode: command not found` | Cài OpenCode CLI: `npm install -g @opencode-ai/cli` |
| Worker không chạy | Kiểm tra `WORKSPACE_ROOT` đã set, thư mục parent của DB tồn tại |
| Verify command fail | Sửa command verify trong `tasks.json` do planner tạo |
| Job treo, không có log | Kiểm tra OpenCode provider config, model có hoạt động không |
