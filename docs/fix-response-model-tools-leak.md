# Hướng dẫn fix lỗi leak model/tools trong response

## Vấn đề

Một số response trả về cho client có thể làm lộ thông tin nội bộ thay vì tên chuẩn mà client mong đợi:

- `model` có thể bị lộ dưới dạng alias nội bộ như `cc/claude-opus-4-7`
- `tool name` có thể bị lộ dưới dạng tên đã cloak/suffix như `_ide`

Điều này gây 2 vấn đề:

1. Client nhìn thấy giá trị không canonical, khó hiểu hoặc không tương thích kỳ vọng.
2. Internal alias/cloaking detail bị rò rỉ ra ngoài boundary của proxy.

## Phạm vi lỗi hiện đã xác nhận

### 1) Leak `model`

Lỗi đã thấy ở response translation path, khi các trường model đi qua translator nhưng chưa được canonicalize trước khi emit ra format đích.

Các shape cần chú ý:

- `state.model`
- `chunk.message.model`
- `chunk.model`
- `chunk.response.model`

Ví dụ lỗi:

```json
{
  "model": "cc/claude-opus-4-7"
}
```

Kết quả mong muốn:

```json
{
  "model": "claude-opus-4-7"
}
```

### 2) Leak `tools`

Leak tools là bài toán liên quan nhưng khác với leak model.

Ví dụ lỗi:

- tool gốc: `extract_terms`
- tool bị cloak nội bộ: `extract_terms_ide`
- client lại nhận `extract_terms_ide`

Kết quả mong muốn là response trả về lại đúng tên gốc `extract_terms`.

## Nguyên nhân

### Leak model

Alias `cc/...` là representation nội bộ, nhưng trước đây chưa được strip ở đầu response translation pipeline. Khi response được translate giữa các format, alias này có thể đi xuyên qua và bị trả thẳng cho client.

### Leak tools

Tên tools có thể bị cloak trong request path để phục vụ provider-specific behavior. Nếu response path không decloak bằng `toolNameMap`, suffix nội bộ như `_ide` sẽ bị lộ ra ngoài.

## Cách fix hiện tại

File chính: `open-sse/translator/index.js`

Đã thêm hàm canonicalize:

```js
function canonicalizeResponseModel(model) {
  if (typeof model !== "string") return model;
  return model.replace(/^cc\//, "");
}
```

Áp dụng trước khi chạy response translation:

- `state.model`
- `chunk.message.model`
- `chunk.model`
- `chunk.response.model`

Mục tiêu là đảm bảo mọi response chunk đi tiếp trong pipeline đều dùng model canonical thay vì alias nội bộ.

## Test hiện có

File test: `tests/unit/response-model-canonicalization.test.js`

Hiện test cover 2 case:

1. Claude stream → OpenAI chunk
2. OpenAI → Responses API event với `state.model`

Kỳ vọng chính:

- `cc/claude-opus-4-7` được đổi thành `claude-opus-4-7`
- response vẫn tiếp tục được emit bình thường

## Những gì bản fix hiện tại CHƯA làm

Cần mô tả chính xác để tránh hiểu nhầm:

- Bản diff hiện tại **chỉ fix leak model alias `cc/...`**
- Bản diff hiện tại **không thêm sửa đổi mới cho leak tools**

Phần tool decloak đã có logic ở chỗ khác trong codebase, nhưng không thuộc diff đang mở.

Các vị trí liên quan:

- `open-sse/handlers/chatCore/nonStreamingHandler.js`
- `open-sse/translator/response/claude-to-openai.js`
- `open-sse/translator/response/gemini-to-openai.js`
- `open-sse/utils/claudeCloaking.js`

Vì vậy nếu viết PR title hoặc changelog, nên dùng diễn đạt chính xác như:

- `fix(response): canonicalize leaked cc/* model aliases`

Không nên ghi mơ hồ là đã fix cả `tools + models` nếu tools chưa có thay đổi mới trong patch này.

## Cách verify

Chạy test mục tiêu:

```bash
cd tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/response-model-canonicalization.test.js --reporter=verbose
```

Nên chạy thêm các test liên quan translator/cloaking:

```bash
cd tests && NODE_PATH=/tmp/node_modules /tmp/node_modules/.bin/vitest run unit/claudeCloaking.test.js unit/gemini-nonstreaming-decloak.test.js unit/openai-to-claude.test.js --reporter=verbose
```

## Khuyến nghị hoàn thiện

Để chốt lỗi này chắc hơn, nên bổ sung thêm test cho:

1. Claude non-streaming response có `model`
2. Các provider/format khác có field `model` ở shape khác
3. Regression test chứng minh tool name không bị lộ suffix `_ide`
4. Case same-format để chắc việc canonicalization không gây side effect ngoài ý muốn

## Tóm tắt

- Lỗi thật đang được fix trong patch hiện tại là **response model alias leak** (`cc/...`)
- Cách fix là canonicalize model ngay đầu `translateResponse()`
- Test hiện tại đủ để chứng minh hướng fix đúng, nhưng coverage còn hẹp
- Leak tools là vấn đề liên quan, nhưng **không phải phần mới được sửa trong diff hiện tại**
