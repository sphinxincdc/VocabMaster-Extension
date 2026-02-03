# License Service: Copy-Paste Commands

## 0) 前置
```bash
# 安装 Wrangler（如未安装）
npm i -g wrangler

# 登录 Cloudflare
wrangler login
```

## 1) 创建 D1
```bash
wrangler d1 create hord-license-db
```
把输出的 `database_id` 填入 `wrangler.toml`（由 `wrangler.toml.example` 复制）。

## 2) 初始化配置文件
```bash
cp wrangler.toml.example wrangler.toml
```
或自动生成：
```bash
node scripts/setup_license_env.mjs --db-id "<D1_DATABASE_ID>" --db-name "hord-license-db" --name "hord-license-service"
```

## 3) 生成 Ed25519 密钥（JWK）
```bash
node scripts/gen_ed25519_jwk.mjs
```
- 复制 `PRIVATE_JWK`，写入 Worker secret。
- 复制 `PUBLIC_JWK`，稍后填到插件设置页“授权公钥 JWK”。

## 4) 写入 Worker secrets
```bash
wrangler secret put LICENSE_KEY_SALT
wrangler secret put LICENSE_SIGN_PRIVATE_JWK
```

## 5) 建表
```bash
wrangler d1 execute hord-license-db --file docs/auth-schema.sql
```

## 6) 生成测试 license SQL
```bash
node scripts/gen_seed_sql.mjs --key "TEST-KEY-2026" --salt "<和 LICENSE_KEY_SALT 一致>" > /tmp/seed.sql
```

## 7) 写入测试 license
```bash
wrangler d1 execute hord-license-db --file /tmp/seed.sql
```

## 8) 部署 Worker
```bash
wrangler deploy
```

## 9) 插件设置页填写
- 授权 API 地址：`https://<your-worker>.workers.dev`
- 授权公钥 JWK：第 3 步输出的 `PUBLIC_JWK`
- License Key：`TEST-KEY-2026`
- 点击“激活授权”

可用脚本打印待填写内容：
```bash
node scripts/print_plugin_auth_config.mjs \\\n+  --api "https://<your-worker>.workers.dev" \\\n+  --pub-jwk '<PUBLIC_JWK_JSON>' \\\n+  --key "TEST-KEY-2026"\n+```

## 10) 联调检查
- 激活后设置页状态应为 `active/pro_annual`
- Manager 中导入导出、批量操作可用
- 高级导图模板（如 `hordSignature/editorial/gradientSoft/boldImpact`）可用

## 11) 一次生成 100 个 Key + SQL + CSV
```bash
node scripts/gen_license_batch.mjs \
  --count 100 \
  --prefix HORD \
  --salt '99999999' \
  --out-sql /tmp/licenses_batch.sql \
  --out-csv /tmp/licenses_batch.csv
```

写入远端 D1：
```bash
wrangler d1 execute hord-license-db --file /tmp/licenses_batch.sql --remote
```

说明：
- `/tmp/licenses_batch.csv` 里包含明文 key，适合发卡与留档。
- `/tmp/licenses_batch.sql` 里是哈希后的 key，可直接入库。
