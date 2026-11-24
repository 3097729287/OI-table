# OI-table

主窗口、设置窗口和业务视图的开发规划遵循[全局界面与首页工作台设计约定](docs/workbench-design.md)，其中包含视觉风格、动效参数、自定义主题的修改入口和验收场景。

首次启动或打包前，用本地的正方形 PNG 或 SVG 生成图标。

```powershell
npm run icon -- "D:/设计/app-icon.png"
```

生成文件位于 `src-tauri/icons/`。
