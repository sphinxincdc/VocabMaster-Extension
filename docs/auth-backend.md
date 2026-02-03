# 授权后台最小实现（零现金成本优先）

## 目标
- 激活时联网校验一次，返回可离线使用的授权证书。
- 插件侧基于证书字段应用 `entitlements`（功能权益）。
- 支持 2 台设备激活上限、到期降级、设备解绑。

## 推荐部署
- API: Cloudflare Workers
- DB: Cloudflare D1
- 密钥: Workers Secrets（仅服务端保存私钥）

## API

### `POST /v1/licenses/activate`
请求：
```json
{
  "license_key": "XXXX-XXXX-XXXX",
  "device_hash": "sha256_hex",
  "product_id": "hord.vocabmaster.chrome",
  "app_version": "2.53.56"
}
```
响应：
```json
{
  "ok": true,
  "certificate": {
    "license_id": "lic_123",
    "product_id": "hord.vocabmaster.chrome",
    "plan": "pro_annual",
    "issued_at": 1760000000000,
    "expires_at": 1791536000000,
    "device_hash": "sha256_hex",
    "entitlements": {
      "word_limit": -1,
      "note_limit": -1,
      "import_export": true,
      "bulk_edit": true,
      "review_mode": "advanced",
      "quote_export_enabled": true,
      "quote_templates": ["light", "dark", "hordSignature", "editorial", "gradientSoft", "boldImpact"],
      "quote_advanced_settings": true
    },
    "cert_version": 1,
    "sig": "base64_signature"
  }
}
```

## 证书签名约定（插件验签）
- 签名算法：`Ed25519`。
- 签名字段：`sig`（base64 或 base64url）。
- 签名原文：对“证书对象去掉 `sig` 字段后”做**递归键排序 JSON 序列化**，再按 UTF-8 字节签名。
- 插件侧会按同样规则重建签名原文并验签。
- 公钥通过设置页填写为 JWK（`{"kty":"OKP","crv":"Ed25519","x":"..."}`）。

> 开发联调可启用“允许未签名证书”开关，但仅建议本地测试使用。

### `POST /v1/licenses/deactivate`
请求：
```json
{
  "license_key": "XXXX-XXXX-XXXX",
  "device_hash": "sha256_hex",
  "product_id": "hord.vocabmaster.chrome"
}
```
响应：
```json
{
  "ok": true
}
```

### `GET /v1/licenses/status`
查询参数：`license_key`, `product_id`

响应：
```json
{
  "ok": true,
  "plan": "pro_annual",
  "expires_at": 1791536000000,
  "max_devices": 2,
  "active_devices": 1,
  "entitlements": {
    "word_limit": -1,
    "note_limit": -1,
    "import_export": true,
    "bulk_edit": true,
    "review_mode": "advanced",
    "quote_export_enabled": true,
    "quote_templates": ["light", "dark", "hordSignature", "editorial", "gradientSoft", "boldImpact"],
    "quote_advanced_settings": true
  }
}
```

## 设备标识建议
- 插件首次安装生成随机 `install_secret`（本地存储）。
- `device_hash = SHA256(install_secret + product_salt)`。
- 不上传真实硬件信息。

## 安全最低线
- 数据库只存 `license_key` 哈希值（不要存明文 key）。
- 私钥只在服务端，用于签名证书；插件仅内置公钥。
- `activate` / `deactivate` 做 IP + key 基础限流。

## 业务规则建议
- Pro 同时激活最多 2 台设备。
- 到期后不删用户数据，返回 Free 权益。
- 自助解绑每 30 天 1 次，超出走人工支持。
