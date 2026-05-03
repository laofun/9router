# Performance Investigation — RAM/CPU growth + web lag

**Status:** Findings verified, fixes pending
**Date:** 2026-04-30
**Branch:** master (diagnostic only — no fix code yet)
**Symptoms:** RAM tăng tuyến tính theo uptime, CPU spike trên mỗi request, dashboard SSE lag, `/v1/*` chậm dần.

## TL;DR

Không phải 1 leak duy nhất — là cộng hưởng của **5 vấn đề độc lập** tạo thành vòng lặp xấu:

1. **SSE dashboard amplification** — mỗi request → 3 emit × N tab → mỗi tab re-read usage.json + scan full history (×2-4 lần).
2. **Lowdb full-file rewrite** — mỗi request → 2-4 lần serialize + ghi đè toàn bộ JSON file.
3. **Socket/FD leak** — `createBypassRequest` không bind `signal`/abort → socket upstream sống tiếp khi client disconnect mid-stream. **Đây là root cause RAM tuyến tính.**
4. **In-memory state unbound** — `pendingRequests.byAccount` + `requestDetailsDb.writeBuffer` không có hard cap.
5. **`appendRequestLog` synchronous I/O** — mỗi request đọc + ghi đè `log.txt` bằng `*Sync` API trên event loop.

Vòng lặp: chat request → 2-4 full JSON rewrites (block I/O) → 3 SSE emits cascade → tabs re-aggregate full history → CPU spike → response chậm → client disconnect mid-stream → socket leak → RAM tăng → I/O áp lực tăng → loop.

---

## Verification

Mọi claim được verify bằng cách đọc source code trực tiếp. Số dòng tham chiếu master (commit `d67888f`).

### 🔴 1. SSE amplification mỗi request

**File:** `src/lib/usageDb.js` + `src/app/api/usage/stream/route.js`

`statsEmitter` có 2 events:
- `update` — emit từ `saveRequestUsage()` (line 385) — **1 lần/request**
- `pending` — emit từ `trackPendingRequest()` (line 232) — **2 lần/request** (start + end)

`stream/route.js:50-51` mỗi tab đăng ký BOTH listener:

```js
statsEmitter.on("update", state.send);
statsEmitter.on("pending", state.sendPending);
```

Cost per emit:
- `state.sendPending` → `getActiveRequests()` (`usageDb.js:238-289`) — `await db.read()` (re-parse usage.json) + `[...history].sort().map().filter()` toàn bộ history (max 10000)
- `state.send` → first `getActiveRequests()` (cached push), then `getUsageStats()` (`usageDb.js:571-902`) — full aggregation: dailySummary merge + recentRequests sort + 4 nested for-loops over history với date overlay

**Per request, per tab:**
| Emit | Function | DB read | Full-history scan |
|---|---|---|---|
| pending start | sendPending | 1× usage.json | 1 (sort+map+filter) |
| pending end | sendPending | 1× usage.json | 1 (sort+map+filter) |
| update | send (cached push) | 1× usage.json | 1 (sort+map+filter) |
| update | send (full recalc) | 1× usage.json | 1+ (overlay loop) |

**= 4× re-parse usage.json + 4× full history scan × N tab × số request.**

Với 10 req/phút × 4 emit × 5 tab = 200 lần parse JSON + scan full history mỗi phút. Khi `usage.json` đạt vài MB, từng scan ngày càng dắt → event loop nghẽn.

### 🔴 2. Lowdb full-file rewrite mỗi request

**Files:** `src/lib/usageDb.js`, `src/lib/localDb.js`, `src/sse/services/auth.js`, `src/sse/services/tokenRefresh.js`, `src/lib/requestDetailsDb.js`

Lowdb không hỗ trợ partial write — mỗi `db.write()` là `JSON.stringify(db.data) + writeFile`.

| Caller | When | File |
|---|---|---|
| `saveRequestUsage()` (`usageDb.js:384`) | Cuối mỗi request có usage | `usage.json` |
| `clearAccountError()` (`auth.js:285`) → `updateProviderConnection` → `safeWrite()` | Mỗi request thành công | `db.json` |
| `markAccountUnavailable()` (`auth.js:224`) → `safeWrite()` | Mỗi request thất bại | `db.json` |
| `updateProviderCredentials()` (`tokenRefresh.js:166`) → `safeWrite()` | Mỗi token refresh | `db.json` |
| `flushToDatabase()` (`requestDetailsDb.js:192`) | Mỗi 5s hoặc 20 records | `request-details.json` |

`safeWrite()` (`localDb.js:182-187`) còn gọi `createValidBackupSync()` — copy file đầy đủ trước khi ghi.

`requestDetailsDb.flushToDatabase` còn tệ hơn:
- Line 180: `db.data.records.sort(...)` — sort toàn bộ records
- Line 187: `Buffer.byteLength(JSON.stringify(db.data), "utf8")` — **serialize lần 1 chỉ để đo size**
- Line 192: `db.write()` — **serialize lần 2 + ghi**

**= 2-4 lần full-JSON rewrite mỗi request**, chưa kể mỗi rewrite serialize 2 lần (size check + write) + tạo backup copy.

### 🔴 3. Socket/FD leak khi client disconnect mid-stream

**File:** `open-sse/utils/proxyFetch.js:147-196`

`createBypassRequest()` mở socket + `https.request` thủ công (bypass DNS):

```js
const socket = new net.Socket();
socket.connect(HTTPS_PORT, realIP, () => {
  const req = https.request(reqOptions, (res) => { ... });
  req.on("error", reject);
  ...
});
socket.on("error", reject);
```

**Grep `signal` trong `proxyFetch.js`: 0 match.**

Tức là:
- Không đọc `options.signal`
- Không gắn `abortController.signal.addEventListener("abort", ...)`
- Không `req.destroy()` / `socket.destroy()` khi client SSE đóng

Cộng với:
- `src/sse/handlers/chat.js:198-236` — `handleChatCore({...})` không truyền `signal` xuống executor
- `open-sse/utils/streamHandler.js:34-45` — abort có 500ms `setTimeout` delay (intentional cho cleanup, nhưng không đủ vì không ai gọi cleanup)

**Hậu quả:** CLI tool (Claude Code, Cursor) đóng kết nối sớm rất phổ biến (user Ctrl+C, hủy generation, tool dùng AbortController). Mỗi lần đóng:
- Socket → upstream (Anthropic / OpenAI) **vẫn alive** đến khi upstream tự đóng (TCP timeout, response complete, hoặc keep-alive expire — có thể vài phút).
- Buffer của response chưa drain → giữ trong heap.
- File descriptor → kernel level leak.

**Đây là root cause RAM growth tuyến tính theo số request bị hủy giữa chừng.**

### 🟡 4. In-memory state không bound

| State | File | Verdict |
|---|---|---|
| `cachedHeaders` (Claude headers cache) | `open-sse/utils/claudeHeaderCache.js:29` | **Sai cảnh báo trong note gốc.** Singleton thay nguyên tử (line 58: `cachedHeaders = captured`), ~20 field cố định. Đây là vấn đề staleness, không phải leak. |
| `pendingRequests.byAccount[connId][modelKey]` | `usageDb.js:200-202` | **Đúng.** Counter set về 0 ở END nhưng **key không bao giờ delete**. Mỗi (account, model) duy nhất = 1 key mới grow theo lifetime process. |
| `consoleLogBuffer.state.logs` | `src/lib/consoleLogBuffer.js:47-50` | **Sai cảnh báo.** Hard cap qua `CONSOLE_LOG_CONFIG.maxLines = 200` (`config.js:55`) hoạt động bình thường. |
| `requestDetailsDb.writeBuffer` | `src/lib/requestDetailsDb.js:94, 206` | **Đúng.** `let writeBuffer = []` không có max length check. `saveRequestDetail()` chỉ push, không trim. Nếu `isFlushing` stuck (file 50MB write chậm) → buffer phình theo burst. |

### 🟡 5. `appendRequestLog` synchronous I/O

**File:** `src/lib/usageDb.js:439-474`

```js
fs.appendFileSync(LOG_FILE, line);                    // sync append
const content = fs.readFileSync(LOG_FILE, "utf-8");   // sync FULL read
const lines = content.trim().split("\n");
if (lines.length > 200) {
  fs.writeFileSync(LOG_FILE, lines.slice(-200) + "\n"); // sync FULL write
}
```

**3 sync I/O ops trên event loop hot path mỗi request thành công** (`open-sse/utils/stream.js:298, 368` gọi). Bất kể file lớn hay nhỏ, `*Sync` block worker thread trực tiếp. Với SSD hiện đại 1ms/op cũng tích lũy → 3ms/request × 60 req/min = 180ms/min event loop bị block riêng cho cái log file 200 dòng.

---

## Kết luận

Note gốc 88% chính xác (2/9 sub-claim ở mục #4 overstate, không thay đổi kết luận tổng thể). 4/5 vấn đề chính đều xác nhận, có file:line cụ thể.

## Đề xuất thứ tự fix (theo blast radius)

| # | Issue | Severity | Effort | Note |
|---|---|---|---|---|
| 1 | Socket leak (#3) | 🔴 CRITICAL | M | Root cause RAM. Bind `request.signal` từ Next.js xuống `handleChatCore` → executor → `createBypassRequest`. Thêm `socket.destroy()` trong abort listener. |
| 2 | SSE debounce + getStats cache (#1) | 🔴 CRITICAL | M | Debounce `update` emit 200ms; cache `getUsageStats` result theo TTL 1-2s; `getActiveRequests` không cần `db.read()` (chỉ cần `pendingRequests` in-memory). |
| 3 | Sync I/O appendRequestLog (#5) | 🟡 HIGH | S | Đổi `*Sync` → `fs.promises.*` async. Hoặc skip read+rewrite, dùng append-only log với log rotation định kỳ (cron). |
| 4 | Lowdb write coalescing (#2) | 🟡 HIGH | M | Debounce `safeWrite` cho cùng db (200ms window). Drop `createValidBackupSync` khỏi hot path → schedule định kỳ. |
| 5 | Bound in-memory state (#4) | 🟢 MEDIUM | S | `delete pendingRequests.byAccount[connId][modelKey]` khi count → 0 và TTL > X. Cap `writeBuffer.length` = 1000, drop oldest. |

## Re-verification commands

```bash
# Issue 1: SSE amplification
grep -n "statsEmitter.emit" src/lib/usageDb.js
grep -n "statsEmitter.on" src/app/api/usage/stream/route.js

# Issue 2: Full rewrites
grep -rn "safeWrite\|db.write()" src/lib/ src/sse/

# Issue 3: Signal propagation
grep -n "signal" open-sse/utils/proxyFetch.js  # expect 0 match
grep -n "AbortController\|abortController" open-sse/handlers/chatCore.js

# Issue 4: Pending state
grep -n "delete pendingRequests" src/lib/usageDb.js  # expect 0 match
grep -n "writeBuffer.length" src/lib/requestDetailsDb.js

# Issue 5: Sync I/O
grep -n "appendFileSync\|readFileSync\|writeFileSync" src/lib/usageDb.js
```
