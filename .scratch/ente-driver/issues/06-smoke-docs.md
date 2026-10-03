# 06: 冒烟脚本与文档

**What to build:** env-gated 真网络冒烟脚本:凭环境变量提供的分享 URL / 账号凭证,对真实 Ente 服务跑通 list + download + thumbnail 并输出摘要(沿用仓库 `scripts/test-*.mts` 惯例,不进 CI)。驱动文档:两个驱动的全部配置字段说明、凭证获取指引(token/master_key 经 OpenList-APIPages 登录页,CLI 无 masterKey 导出)、无 Range、设备位风险等已知限制。

**Blocked by:** 05

**Status:** resolved

- [x] 冒烟脚本对真实分享 URL 跑通 list + download + thumbnail,输出文件数/字节数/抽样文件名摘要
- [x] 文档覆盖 EnteShare 与 Ente 全部配置字段及默认值,注明已知限制与凭证来源

## Answer

完成(2026-10-03):

- `scripts/test-ente.mts`:环境变量 `ENTE_SHARE_URL` 或 `ENTE_TOKEN`+`ENTE_MASTER_KEY`(+`ENTE_SECRET_KEY`/`ENTE_SHOW_HIDDEN`/`ENTE_ENDPOINT`)二选一;缺省打印 skip 正常退出(不进 CI)。分享模式列根目录,账号模式进第一个相册;输出条目数、抽样前 5 个文件名/大小/时间/thumb 标记,下载首个有缩略图的文件,校验明文字节数与 `info.fileSize` 一致并输出 sha256 摘要,缩略图输出字节数与 jpeg 头(255,216,255)。已验证:skip 路径、坏分享 URL 的错误路径(构造函数即报 invalid collection key)。
- `docs/drivers/ente.md`:EnteShare(share_url/endpoint)与 Ente(token/master_key/secret_key/show_hidden/endpoint)全字段表含默认值;凭证获取指引(OpenList-APIPages 登录页,CLI 无 masterKey 导出);已知限制(无 Range、严格只读、密码保护分享不支持、设备位风险、410/403 owner 侧限制)。
- 验证:`npm run test:all` 400 测试 0 失败;`tsc --noEmit` 仅剩既有 db_cipher.test.ts 两处错误。
