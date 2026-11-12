# 提审发布手册（dbx-store）

插件当前状态：**未签名 review candidate**（dist/cando.gameisland-0.1.0-universal.dbxp）。
本文记录从候选包到上架 t8y2/dbx-store 的完整路径。

## 前置

- 公开 GitHub 仓库（本仓库推上去后，把 `manifest.json` 的 `source` 字段补上仓库地址）
- GitHub 账号在 t8y2/dbx-store Fork 一份

## 步骤

1. **打 Release**：推送 tag（v0.1.0）→ `.github/workflows/release.yml` 自动构建并上传
   未签名 `.dbxp` + `.artifact.json` 到 GitHub Release。
   （本机打包等价命令：`npm run build && npm run package`，产物在 dist/）
2. **注册 publisher**：向 dbx-store 的 `main` 分支提交 `publishers/cando.json`（publisher 身份 +
   审核记录，具体字段以 dbx-store 仓库 `publishers/` 目录现有文件为模板）。
3. **提候选 PR**：向 dbx-store `main` 分支提 PR，内容为插件候选元数据（对应
   `candidates/cando.gameisland.json`）。若在 dbx-store 的
   `automation/plugin-sources.json` 登记了本仓库且 `autoUpdate: true`，打 Release 后
   同步 Workflow 会自动建/更新候选 PR，可省手工步骤；登记格式见 dbx-store 仓库。
4. **审核**：维护者核对源码、Manifest、权限（本插件仅 `host.storage`，无网络）、SHA-256、
   大小与原生行为（无原生 Sidecar）；通过后由 dbx-store 私钥做 Ed25519 签名并发布正式包。
   开发者不接触私钥，不要自填 `signingKeyId`。
5. **合并**：签名结果回写候选 PR，生成 `plugins/cando.gameisland.json` +
   `catalog/index.json`，校验通过后合并。合并后插件出现在 DBX 插件中心。

## 约束备忘

- `id`（cando.gameisland）与 `publisher`（cando）**首次上架后不可更改**；后续更新只递增
  `version`（semver），只提交新版本候选，不手工编辑已生成的 `plugins/`、`catalog/` 文件。
- PR 中禁止包含 .dbxp 二进制、私钥、伪造 verified 标记。
- 更新日志建议跟随版本写在 GitHub Release 正文，审核记录挂在候选 PR。

## 已知上游问题（提审前如未修复，附在候选 PR 说明里）

- `@dbx-app/plugin-cli` 0.1.10 在 Windows 把项目路径规范成 `\\?\E:\...` 传给子进程作 cwd：
  cmd.exe（npm 垫片）与 node 相对模块解析都不认，`[dev] ui_build/ui_watch` 必然失败。
  本仓库规避方式：不配 `[dev]` 构建命令，先 `npm run build` 再 `dbx-plugin dev` 静态服务。
- 开发宿主沙箱 CSP 为 `connect-src 'none'; script-src 'unsafe-inline' blob:`，懒加载
  chunk 无法取回；本仓库用 `inlineDynamicImports` 单文件构建规避（真宿主无此限制）。
- 开发宿主 iframe 是 `about:srcdoc`，hash 写入会触发 iframe 导航炸掉沙箱；本仓库路由用
  memory history 规避（真宿主 `dbx-plugin://` 真实 URL 无此问题）。
