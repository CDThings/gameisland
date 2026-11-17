# dbx-store 提审材料（v0.1.0）

状态：**材料已备好，待用户 Fork t8y2/dbx-store 并提交 PR**。

## 提交流程（按 dbx-store CONTRIBUTING.md，走 PR 不走 Issue）

1. Fork `t8y2/dbx-store` → 在自己的 fork 上新建分支（如 `submit-cando.gameisland`）
2. 新建两个文件（内容用本目录 `publishers/cando.json` 与 `candidates/cando.gameisland.json`）：
   - `publishers/cando.json`
   - `candidates/cando.gameisland.json`
3. 向 `t8y2/dbx-store:main` 开 PR，正文用下方 PR 模板，并按模板勾三项确认清单
4. CI 校验候选字节后转红状态 "open candidate(s) awaiting DBX Store signing"（设计如此）→
   维护者跑受保护签名 workflow（仓库密钥 Ed25519 签名、发 R2、生成
   `plugins/cando.gameisland.json` + `catalog/index.json`、移除 candidate）→ 转绿 → 维护者合并
5. 上架后在 DBX 插件中心可见

## candidates/cando.gameisland.json（提交文件 2/2）

> 字段以 dbx-store 现行 schema 为准；若 CI 报缺字段/多字段，按报错补改再 push（URL/SHA 固定不变）。
> sha256/size 锁定未签名候选字节，签名时任何不匹配都会拒绝。

```json
{
  "schemaVersion": 1,
  "id": "cando.gameisland",
  "publisher": "cando",
  "version": "0.1.0",
  "name": "游戏岛 Game Island",
  "description": "十款纯离线小游戏：掼蛋 / 牛牛 / 德州扑克 / 麻将四张牌桌（1 人 + 3 AI 同屏），打地鼠 / 小猫钓鱼 / 扫雷 / 跳棋 / 飞行棋 / 五子棋六款亲子游戏。零网络权限，存档保存在本机。",
  "icon": "https://github.com/CDThings/gameisland/raw/v0.1.0/assets/plugin.svg",
  "tags": ["game", "offline", "workbench"],
  "permissions": ["host.storage"],
  "source": "https://github.com/CDThings/gameisland",
  "license": "MIT",
  "releaseNotes": "v0.1.0 首发：十款纯离线游戏，仅 host.storage 权限。",
  "localizations": {
    "zh-CN": {
      "name": "游戏岛",
      "description": "十款纯离线小游戏：掼蛋 / 牛牛 / 德州扑克 / 麻将四张牌桌（人机同屏），打地鼠 / 小猫钓鱼 / 扫雷 / 跳棋 / 飞行棋 / 五子棋六款亲子游戏。零网络权限，存档保存在本机。"
    }
  },
  "targets": [
    {
      "target": "universal",
      "url": "https://github.com/CDThings/gameisland/releases/download/v0.1.0/cando.gameisland-0.1.0-universal.dbxp",
      "sha256": "fe596e88e766e4ebcf5b0c44ad672b1e575cc9737bcc53198e3fdf6d9ffdcdf0",
      "size": 115128
    }
  ]
}
```

## publishers/cando.json（提交文件 1/2，仅首次提交需要）

```json
{
  "id": "cando",
  "name": "cando",
  "status": "unverified"
}
```

> status 取 unverified（与 xingxi 等既有 publisher 一致；verified 由审核方判定，不自填）。

## PR 正文（填 PR 模板用）

- **Plugin ID**: cando.gameisland
- **Version**: 0.1.0
- **Publisher**: cando
- **Source**: https://github.com/CDThings/gameisland @ tag `v0.1.0`（immutable）
- **What it contributes**: 一个沙箱前端 workbench「游戏岛」：四张牌桌（掼蛋/牛牛/德州/麻将，1 人 + 3 本地 AI 同屏，掼蛋按官方规则实现同型互压/炸弹阶梯/贡牌接风）+ 六款亲子小游戏。用户打开工作台即玩，无连接、无数据库操作。
- **Permissions / data / network / files**: 仅 `host.storage`（单键 `cando.kv.v1` 存游戏存档/战绩/静音偏好，单值 256KiB 限内）；**零网络权限、零 credentials 访问、不读连接数据**。
- **Native sidecar**: None（纯前端 universal 包，无原生可执行文件、无子进程、无端口、无文件系统写入）。
- **License**: MIT
- **Homepage**: （暂无，可后续补）

确认清单三项（候选包由官方复用 workflow 构建，SHA 以 release-candidates.json 为准）：
- [x] 候选为未签名、与公开源码 tag v0.1.0 一致（GitHub Actions `Release DBX plugin` 构建）
- [x] 未包含私钥 / token / 凭据 / 专有数据
- [x] 候选仅列于 `candidates/cando.gameisland.json`，未手工编辑 `plugins/` 与 `catalog/`

## 后续

- 上架签名后：DBX 插件中心出现「游戏岛」，客户端即可安装（本机 0.6.69-beta 可装正式版）
- 版本更新只提 `candidates/cando.gameisland.json` 新版本，不动 plugins/、catalog/
- 可选登记 `automation/plugin-sources.json`（autoUpdate 自动建候选 PR），登记格式看 dbx-store 该文件
- 两个新提交（447bd5f 补 ui 目录 / CI 修复）未 push 到 Space 内部 GitLab 库的 dbxp/ 目录（该目录已被 Space/.gitignore 忽略，仅 GitHub 仓有最新版——如需本地与 GitHub 对齐，Space/dbxp 目录是独立 git 仓库，已随 push 更新）
