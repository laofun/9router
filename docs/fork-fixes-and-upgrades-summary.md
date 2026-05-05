# Tóm tắt các vấn đề đã fix và nâng cấp trong fork n9router

Tài liệu này mô tả ngắn gọn từng vấn đề chính đã được xử lý trong fork `laofun/9router` và cách giải quyết tương ứng.

## 1. Sai shape `tool_choice` khi dịch từ OpenAI sang Claude

**Vấn đề**
- Một số client gửi `tool_choice` theo shape OpenAI: `{type:"function", function:{name}}`
- Claude không nhận trực tiếp shape này.

**Cách giải quyết**
- Chuẩn hóa `tool_choice` sang shape Claude: `{type:"tool", name}`
- File chính: `open-sse/translator/request/openai-to-claude.js`

## 2. Không forward đầy đủ cache usage của Claude sang format OpenAI

**Vấn đề**
- Response Claude có `cache_creation_input_tokens` và `cache_read_input_tokens`
- Trước đây các giá trị này không được forward đầy đủ sang usage/prompt token details kiểu OpenAI.

**Cách giải quyết**
- Bổ sung mapping cho cả streaming và non-streaming response
- Files chính:
  - `open-sse/translator/response/claude-to-openai.js`
  - `open-sse/handlers/chatCore/nonStreamingHandler.js`

## 3. Claude OAuth cloaking làm mất tính ổn định của prompt cache

**Vấn đề**
- Nếu dữ liệu cloaking thay đổi không ổn định giữa các request, Anthropic prompt cache có thể không hit dù prompt thực tế giống nhau.

**Cách giải quyết**
- Giữ `_buildHash` và `_cch` ổn định theo vòng đời process thay vì thay đổi liên tục
- File chính: `open-sse/utils/claudeCloaking.js`

## 4. `tool_choice.name` không được cloak đồng bộ khi dùng Claude OAuth

**Vấn đề**
- Tool definitions có thể đã được suffix nội bộ, nhưng `tool_choice.name` chưa được đổi tương ứng
- Dẫn đến mismatch giữa tool được chọn và tool đã gửi lên provider.

**Cách giải quyết**
- Áp dụng suffix `_ide` cho `tool_choice.name` khi `type === "tool"`
- Có guard để tránh gắn suffix hai lần
- File chính: `open-sse/utils/claudeCloaking.js`

## 5. Tool name bị lộ suffix nội bộ `_ide` trong response non-streaming

**Vấn đề**
- Một số response non-streaming từ Gemini/Antigravity có thể trả tool name đã bị cloak như `extract_terms_ide`
- Đây là chi tiết nội bộ, không nên lộ ra client.

**Cách giải quyết**
- Truyền `toolNameMap` xuyên suốt non-streaming path và decloak trước khi trả response
- File chính: `open-sse/handlers/chatCore/nonStreamingHandler.js`
- Test liên quan: `tests/unit/gemini-nonstreaming-decloak.test.js`

## 6. Thiếu hygiene cho cache TTL 1 giờ của Anthropic

**Vấn đề**
- Khi dùng `cache_control.ttl: "1h"`, nếu thiếu beta header tương ứng thì hành vi có thể không đầy đủ hoặc không nhất quán.

**Cách giải quyết**
- Thêm header beta `extended-cache-ttl-2025-04-11`
- File chính: `open-sse/config/providers.js`

## 7. Explicit thinking OFF có thể bị bật lại bởi default của provider

**Vấn đề**
- Nếu client gửi `reasoning_effort: "none"` hoặc `thinking: { type: "disabled" }`, đây là yêu cầu tắt thinking rõ ràng
- Một số path normalize/translate/executor có thể vô tình coi đây là “unset” và bật lại default thinking của provider.

**Cách giải quyết**
- Giữ invariant: explicit OFF phải được preserve end-to-end
- Rà và gia cố ở các path normalize, translator và executor
- Files chính:
  - `open-sse/services/provider.js`
  - `open-sse/handlers/chatCore.js`
  - `open-sse/translator/request/openai-to-claude.js`
  - `open-sse/translator/request/openai-to-gemini.js`
  - `open-sse/executors/codex.js`
  - `open-sse/executors/github.js`
  - `open-sse/executors/qwen.js`
- Test liên quan: `tests/unit/thinkingControl.test.js`

## 8. Prompt cache trên Claude OAuth có hit nhưng không có số liệu cache tokens

**Vấn đề**
- Khi gọi qua Claude OAuth (`sk-ant-oat`), latency cho thấy cache có hit
- Nhưng response không populate `cache_read_input_tokens` / `cache_creation_input_tokens`
- Điều này dễ bị hiểu nhầm là cache không hoạt động.

**Cách giải quyết**
- Chạy chẩn đoán và xác nhận bản chất vấn đề là limitation về telemetry/billing exposure của OAuth tier, không phải lỗi proxy
- Kết luận vận hành:
  - OAuth vẫn được lợi về latency
  - Nếu cần thấy cache metrics rõ ràng, dùng direct API key thay vì OAuth
- Nhánh tham chiếu: `diag/cache-miss` (không merge vào production)

## 9. MITM path cần giữ bản hardened của fork khi sync upstream

**Vấn đề**
- Khi nhận thay đổi lớn từ upstream, một số phần MITM của fork có nguy cơ bị mất các hardening quan trọng.

**Cách giải quyết**
- Giữ lại implementation mạnh hơn của fork trong conflict resolution, gồm:
  - debug context tốt hơn
  - RTK compression
  - multi-store cert install với WSL support
  - DNS error reporting tốt hơn
- Khu vực chính: `src/mitm/`

## 10. Upstream từng xóa `open-sse/rtk/flag.js` nhưng fork vẫn còn caller phụ thuộc

**Vấn đề**
- Upstream đã xóa file này, nhưng fork vẫn còn code gọi `isRtkEnabled()` và `setRtkEnabled()`
- Nếu xóa theo upstream sẽ làm hỏng runtime/settings path của fork.

**Cách giải quyết**
- Khôi phục và giữ lại `open-sse/rtk/flag.js` cho đến khi toàn bộ caller được rewiring
- Các caller tiêu biểu:
  - `open-sse/rtk/antigravity.js`
  - `src/app/api/settings/route.js`

## 11. Fork cần giữ identity riêng thay vì quay lại mặc định upstream

**Vấn đề**
- Khi sync upstream, package metadata và app identity có thể bị kéo ngược về `9router`
- Điều này gây sai binary name, config path và branding của fork.

**Cách giải quyết**
- Giữ ổn định identity của fork:
  - package name: `n9router`
  - binary: `n9router`
  - appName: `n9router`
  - data/config dir: `~/.n9router`
- Files/khu vực liên quan:
  - `package.json`
  - app config paths

## 12. Response có thể làm lộ alias model nội bộ `cc/...`

**Vấn đề**
- Một số response path có thể trả `model` dưới dạng alias nội bộ như `cc/claude-opus-4-7`
- Đây không phải tên canonical mong đợi bởi client.

**Cách giải quyết**
- Canonicalize model sớm trong response translation path bằng cách strip prefix `cc/`
- Áp dụng cho các shape:
  - `state.model`
  - `chunk.message.model`
  - `chunk.model`
  - `chunk.response.model`
- File chính: `open-sse/translator/index.js`
- Test liên quan: `tests/unit/response-model-canonicalization.test.js`

## 13. Hướng nâng cấp tổng thể của fork

**Vấn đề**
- Upstream ưu tiên mở rộng provider coverage, nhưng fork cần tập trung hơn vào độ ổn định và trải nghiệm self-hosted production.

**Cách giải quyết**
- Định hướng fork theo 3 trục:
  - reliability hardening
  - Antigravity deep integration
  - self-hosted production polish
- Khi nhận code từ upstream, chỉ lấy những phần phù hợp với định hướng này thay vì merge máy móc 1:1.

## Tóm tắt

Fork `n9router` không chỉ thêm provider hay đổi branding, mà chủ yếu giải quyết các nhóm vấn đề sau:

- sai khác format translation giữa OpenAI / Claude / Gemini
- rò rỉ chi tiết nội bộ như alias model hoặc cloaked tool names
- mất tính ổn định của prompt cache
- preserve thinking control đúng theo request của client
- giữ các hardening quan trọng của fork khi đồng bộ upstream

Nói ngắn gọn: fork này ưu tiên làm cho routing core ổn định hơn, ít rò rỉ chi tiết nội bộ hơn, và an toàn hơn cho vận hành self-hosted.
