# 题库数据与本地题包

应用将题库存入 Tauri 应用数据目录下的 `problem-library.sqlite3`。新数据库在首次访问时通过事务创建当前结构，并将 SQLite 的 `user_version` 设为 `1`。题包的 `formatVersion` 和每个库的 `releaseVersion` 各自独立。

## 本地题包

在桌面应用的「题库 → 题库管理」点击「导入题包」。把一个文件夹或 ZIP 拖进弹窗，也可以用系统选择器选择。核对弹窗显示的名称后点击「导入」。完成后可在右下角展开导入详情，失败时在弹窗查看原因并重试。

根目录含有 `manifest.json` 时导入一个题库，否则查找子目录中的清单并导入所有题库。可选择 `examples/problem-libraries` 目录，也可以将整个目录压缩为 ZIP 后选择该文件。所有题库校验通过后在同一个 SQLite 事务写入，格式错误或版本冲突会回滚整批改动。

题库名称旁显示发行版本，整理者列优先显示清单里的名称，其次显示整理者 ID。可以在对应题库行启用、停用或卸载。重新安装已卸载的库时，再选择该库的题包。

可使用 [基础算法库](../examples/problem-libraries/example-basics) 和 [图论库](../examples/problem-libraries/example-graphs) 作为模板。每个库目录有一份 `manifest.json`，题面和题解使用相对路径引用 UTF-8 Markdown。每个库最多 32 MiB 和 32768 个文件，单次导入最多 128 MiB，目录下最多 131072 个文件，ZIP 内最多 131072 个条目。库目录之间可有包装层，库目录内部仅包含清单和清单引用的文件。

- `formatVersion` 当前为 `1`。`libraryId` 确定库的身份，`releaseVersion` 是由发行者递增的正整数。
- `complete` 为 `true` 时表示该库的完整快照，缺项会下架。设为 `false` 时只更新清单里的记录，继续保留未列出的题目和目录。每包都需声明自己引用的标签和归档目录，包括所有祖先目录。
- `authorId` 是题库整理者的 ID，和可选的整理者显示名称 `authorName` 一起放在 `manifest.json` 顶层，供整包题目共用。题目 ID 形如 `example-basics:demo:1`，由顶层 `libraryId`、顶层 `authorId` 和该题的 `sequence` 组成。ID 片段用小写英文字母、数字、短横线和下划线。序号与发行版本限于 JavaScript 安全整数范围内的正整数。更新时沿用 `authorId` 和已分配的序号，标题、显示名称和归档位置可以修改。
- 本地化字段使用 `{ "zhCN": "…", "en": "…" }`。只提供一种语言时，题面和题目标题必须有同一种语言，题解内容和题解标题也遵循这一约定。题解可独立指定 ID，并随题目版本保存。双语名称适用于题库、署名、归档和标签。
- 归档节点保存父目录 ID。查询可以统计直属题目，也可以包含所有后代目录。题目通过 `tags` 关联一个或多个平级标签，标签题单按这些关联查询。

### 题目目录与默认文件名

每个 `problems` 项可以用 `folder` 指定题目目录。路径以题包根目录为起点，用 `/` 分隔。省略 `statement` 或某篇题解的 `body` 时，导入器根据对应标题中提供的语言读取以下文件。

| 内容 | 中文 `zhCN` | 英文 `en` |
| --- | --- | --- |
| 题面 | `<folder>/statement.zh-cn.md` | `<folder>/statement.en.md` |
| 只有一篇题解 | `<folder>/solution.zh-cn.md` | `<folder>/solution.en.md` |
| 有多篇题解 | `<folder>/solutions/<id>.zh-cn.md` | `<folder>/solutions/<id>.en.md` |

每篇题解仍通过 `solutions` 声明自己的 `id` 和 `title`。题面标题和题解标题分别决定需要读取哪些语言。缺少对应的文件时，导入会提示缺失路径。

自定义文件名时可以显式填写 `statement` 或 `body`，路径依旧从题包根目录解析。所有题面和题解都显式指定路径时可以省略 `folder`。给原本只有一篇题解的题目新增题解时，可以用显式 `body` 继续引用原文件。

以下清单使用默认路径，并从 `range-sums/` 读取中英文题面与题解。

```json
{
  "formatVersion": 1,
  "libraryId": "example-default-paths",
  "name": { "zhCN": "默认路径示例库", "en": "Default Paths Example Library" },
  "authorId": "demo",
  "releaseVersion": 1,
  "complete": true,
  "problems": [
    {
      "sequence": 1,
      "folder": "range-sums",
      "title": { "zhCN": "区间求和", "en": "Range Sums" },
      "solutions": [
        { "id": "prefix-sums", "title": { "zhCN": "前缀和", "en": "Prefix Sums" } }
      ]
    }
  ]
}
```

## 浏览题库与归档

「题库 → 全部题目」列出已启用题库的题目。点击箭头展开标签题单，点击标签名称打开对应列表。多标签题目会出现在各自对应的题单中。

「归档 → 题库归档」按题库显示目录。点击目录名称打开题单，包含该目录及其后代目录中的题目。点击箭头展开直属子目录和题目。题单支持按标题或题目 ID 搜索和分页，点击题目打开独立标签页。

## 更新与历史

导入先校验整包，再开启 SQLite 写事务。题库按发行版本比较先后。同版本的相同包可重试，内容有冲突时返回错误，旧版本不能覆盖新版本。清单哈希包含库名、整理者、归档、标签定义以及各题的哈希。题目哈希包含双语内容、题解、署名、等级分、归档 ID 和标签关联。摘要根据校验后的内容计算。默认路径和显式路径解析到相同内容时，哈希一致。JSON 数组的排列顺序也不影响结果。个人收藏、题单成员关系和提交记录独立保存。

题目内容发生变化时，以当次发行版本保存新的内容版本。完整快照下架的题目保留 ID 和已保存版本。停用和卸载都会将库从题目列表、标签题单和归档树中隐藏。卸载后仍保留历史内容与关系数据，重装同一版本或更新版本时恢复该库身份。指定题目 ID 和内容版本仍可读取历史详情，归档和标签名称使用库当前保存的名称。

## Tauri 接口

前端共享接口位于 [problemLibrary.ts](../src/shared/problemLibrary.ts)。管理页通过原生命令选择并导入文件夹或 ZIP。

| 命令 | 输入与结果 |
| --- | --- |
| `pick_problem_library_source` | 接收 `source`（`directory` 或 `zip`）和选择器标题 `title`，返回所选路径，取消时返回 `null`。 |
| `import_problem_libraries_from_path` | 接收文件夹或 ZIP 的绝对路径 `path`，返回逐库导入结果。 |
| `list_problem_libraries` | 返回已知题库及其发行版本和状态，包含已卸载的库。 |
| `set_problem_library_enabled` | 用 `libraryId` 和 `enabled` 切换启停。已卸载的库可通过导入题包重新安装。 |
| `uninstall_problem_library` | 按 `libraryId` 卸载。 |
| `list_library_problems` | 接收 `query`，支持库、归档、标签和中英文标题搜索。用 `tagId` 查带指定标签的题，用 `untagged: true` 查没有标签的题。按归档筛选时，`includeDescendants: true` 包含子目录，省略时只查直属题目。每页最多 50 条，下一页将 `nextCursor` 传给 `after`。 |
| `get_library_problem` | 按 `id` 读取详情，传入 `contentVersion` 可读取历史版本。 |
| `list_library_archive_children` | 按 `libraryId` 和可选 `parentId` 列出直属目录，返回每个目录的直属题数 `problemCount` 和包含后代目录的题数 `subtreeProblemCount`。 |
| `list_library_tag_groups` | 查询启用题库中当前在架题目的标签、双语名称和题数，可用 `libraryId` 缩小范围。跨库合并相同标签 ID，名称取参与该分组且 ID 排在最前的题库定义。无标签的分组返回 `id: null` 和 `name: null`。 |

后端失败返回 `{ code, message }`。题包格式或引用异常使用 `invalid_package`，低于已安装发行版本时返回 `stale_release`，同版本内容冲突时返回 `release_conflict`。数据库结构版本不受支持时返回 `unsupported_database`，原数据库文件保留在原处。

## 验证

```powershell
cargo test --manifest-path src-tauri/Cargo.toml problem_library
```

测试使用临时 SQLite 库，覆盖独立发行版本、同版本重试与冲突、完整和部分更新、事务回滚、停用和卸载重装。SQLite 外键保留收藏、题单和提交对原题的引用，提交还可关联当时的内容版本。
