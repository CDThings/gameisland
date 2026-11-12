# 游戏岛 Game Island

一个纯离线的 [DBX](https://github.com/t8y2/dbx) 插件：在数据库工具里摸鱼用的十款小游戏。

- **四张牌桌**（1 人 + 3 个 AI 同屏，五个 AI 难度）：
  - 掼蛋 —— 组队配合，同型互压、炸弹阶梯、贡牌接风等按官方规则实现
  - 牛牛 —— 比牌互赔，快节奏
  - 德州扑克 —— 位置与心理博弈
  - 麻将 —— 推倒胡，番数制
- **亲子小游戏**（大人小孩一起玩，大按钮大字体）：打地鼠、小猫钓鱼、扫雷、跳棋、飞行棋、五子棋

全部游戏**零网络依赖**：插件不申请网络权限，AI 对手在本地跑，牌局续档与战绩存档通过 DBX 宿主存储保存在本机。

## 安装

上架后直接在 DBX 插件中心搜「游戏岛」。

开发者侧载（未签名包）：DBX → 插件中心 → 设置 → 展开「第三方与开发者选项」→ 勾选「允许安装未签名开发包」→ 安装 `.dbxp` 选择 dist 下的产物。

## 开发

```bash
npm --prefix app install     # 前端依赖
npm test                     # 卡牌引擎单测（node --test，38 个文件）
npm run build                # vite build → 产出 ui/
npm run dev:plugin           # dbx-plugin dev 开发宿主（http://127.0.0.1:5190）
npm run package              # 打未签名 .dbxp（产物在 dist/）
```

需要 Node 22+ 与全局安装的 `@dbx-app/plugin-cli`（仅 dev/package 子命令需要）。

## 结构

```
├── app/            # 前端工程（Vue 3 + Vite，hash 路由，base './'）
│   └── src/        # 岛首页 / 四牌桌 / 亲子游戏 / 存储适配层
├── shared/         # 卡牌引擎（纯函数）+ 引擎单测
│   ├── src/        # 掼蛋状态机、AI、牌型、贡牌；牛牛/德州/麻将引擎
│   └── test/       # node --test 直跑
├── ui/             # 构建产物（gitignore，DBX 包内静态资源）
├── manifest.json   # DBX 插件契约
└── dbx-plugin.toml # 开发与打包配置
```

存储适配：DBX 插件 UI 运行在隔离 iframe（opaque origin），localStorage 不可用；`app/src/env.js`
把牌局存档 / 亲子战绩 / 静音偏好统一接到 `window.dbxPlugin.storage`（单键打包 + 防抖刷回），
普通浏览器环境自动回落 localStorage，两边都是同步语义。

## 许可

[MIT](./LICENSE)
