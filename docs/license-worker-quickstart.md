# License Worker Quickstart

## 1) 准备
- 安装 Wrangler（Cloudflare CLI）。
- 建立 D1 数据库并执行 `docs/auth-schema.sql`。
- 将 `scripts/license_worker_example.mjs` 作为 Worker 入口。
- 复制 `wrangler.toml.example` 为 `wrangler.toml` 并填写 D1 `database_id`。

## 2) 环境变量 / Secret
- `LICENSE_KEY_SALT`（secret）
- `LICENSE_SIGN_PRIVATE_JWK`（secret，Ed25519 私钥 JWK JSON）
- `DB`（D1 binding）

示例命令：
```bash
wrangler secret put LICENSE_KEY_SALT
wrangler secret put LICENSE_SIGN_PRIVATE_JWK
```

## 3) 私钥示例格式
```json
{"kty":"OKP","crv":"Ed25519","x":"PUBLIC_X","d":"PRIVATE_D"}
```

可用脚本快速生成：
```bash
node scripts/gen_ed25519_jwk.mjs
```

## 4) 插件设置页配置
- 授权 API 地址：你的 Worker 域名（例如 `https://license.example.workers.dev`）。
- 授权公钥 JWK：对应私钥的公钥 JWK（仅 `kty/crv/x`）。
- 开发联调时可临时启用“允许未签名证书”。

## 5) 最小联调步骤
1. 插入测试 license：
   - 用 `docs/auth-seed-example.sql` 模板。
   - 先生成 hash：`node scripts/hash_license_key.mjs --key "TEST-KEY-2026" --salt "YOUR_LICENSE_KEY_SALT"`。
   - 将 hash 填回 SQL 后执行。
2. 插件设置页填写 License Key、API 地址、公钥。
3. 点击“激活授权”，确认状态变为 active。
4. 在 manager 验证 Pro 功能（导入导出/批量/高级导图）解锁。

## 6) 本地发布
```bash
wrangler d1 execute hord-license-db --file docs/auth-schema.sql
wrangler deploy
```
