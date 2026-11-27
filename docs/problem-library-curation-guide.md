# 题库整理指南 第 1 版

本指南面向为 OI-table 整理题目的人员，适用于 `formatVersion` 为 `1` 的题包。按下面的步骤准备 `manifest.json`、题面和题解，即可在支持题包导入的 OI-table 桌面版中安装和更新题库。

## 从一题开始

1. 新建一个题库文件夹。把示例里的 `range-sums/` 复制进去，作为第一道题。 [基础算法示例](../examples/problem-libraries/example-basics)
2. 在题库文件夹根目录创建 `manifest.json`，填上自己的题库 ID、整理者 ID 和显示名称。新库的 `releaseVersion` 从 `1` 开始。
3. 在桌面版打开「设置 → 数据 → 题库管理 → 导入题包」，拖入题库文件夹或通过选择器选中它，再确认导入。打开新题库，检查题目标题、题面和归档位置。

本例的目录如下。

```text
my-basics/
├── manifest.json
└── range-sums/
    ├── statement.zh-cn.md
    ├── statement.en.md
    ├── solution.zh-cn.md
    └── solution.en.md
```

保存下面的清单，即可按默认文件名读取这四份 Markdown。发布自己的题库前，将 `my-basics` 和 `demo` 换成你分配的稳定 ID。

```json
{
  "formatVersion": 1,
  "libraryId": "my-basics",
  "name": { "zhCN": "基础算法练习", "en": "Basic Algorithms Practice" },
  "authorId": "demo",
  "authorName": { "zhCN": "示例整理者", "en": "Example Curator" },
  "releaseVersion": 1,
  "complete": true,
  "archives": [
    { "id": "algorithms", "name": { "zhCN": "基础算法", "en": "Basic Algorithms" } },
    { "id": "sequences", "parentId": "algorithms", "name": { "zhCN": "序列", "en": "Sequences" } }
  ],
  "tags": [
    { "id": "prefix-sums", "name": { "zhCN": "前缀和", "en": "Prefix Sums" } }
  ],
  "problems": [
    {
      "sequence": 1,
      "folder": "range-sums",
      "title": { "zhCN": "区间求和", "en": "Range Sums" },
      "rating": 900,
      "archiveId": "sequences",
      "tags": ["prefix-sums"],
      "solutions": [
        { "id": "prefix-sums", "title": { "zhCN": "前缀和", "en": "Prefix Sums" } }
      ]
    }
  ]
}
```

## 填写清单

| 字段 | 填写规则 |
| --- | --- |
| `formatVersion` | 填 `1`。这是清单格式的版本。 |
| `libraryId` 和 `name` | 分别填写题库的稳定 ID 和显示名称。更新时沿用同一个 `libraryId`。 |
| `authorId` 和 `authorName` | 在清单顶层填写题库整理者 ID，整包共用。`authorName` 可选，用于显示整理者名称。需要保留原题署名时，可在题面注明来源。 |
| `releaseVersion` | 题库的发行版本。每次发布有内容变化的新版本时递增。 |
| `complete` | 完整题库填 `true`。只发布本次新增或修改的记录时填 `false`。 |
| `archives` 和 `tags` | 可选，分别声明归档目录和标签。 |
| `problems` | 每项登记一道题。填写 `sequence`、`title`，以及用于定位题面的 `folder` 或 `statement`。 |

题目 ID 由 `libraryId`、`authorId` 和 `sequence` 拼成。本例第一道题的 ID 为 `my-basics:demo:1`。已发布的题目更新标题、正文或归档位置时，沿用原序号。下架的序号留给原题。

各类 ID 可用小写英文字母、数字、短横线和下划线，首字符使用字母或数字，最长 64 个字符。`sequence` 和 `releaseVersion` 使用 1 到 9,007,199,254,740,991 之间的整数。可选的 `rating` 使用 0 到 4,294,967,295 之间的整数。

- **归档**用 `parentId` 表示父目录。顶层目录省略 `parentId`。题目通过 `archiveId` 指向归档目录。可用 `sortOrder` 控制同级目录的先后，较小值靠前。
- **标签**用来给题目分类。先在清单顶层 `tags` 声明标签 ID 和中英文名称，再在每题的 `tags` 中引用这些 ID。例如「区间求和」引用 `prefix-sums`，就关联了「前缀和」标签。一题可以关联多个标签。
- **题解**在每题的 `solutions` 中逐篇登记。每篇填写题内唯一的 `id` 和 `title`，正文可由默认文件名定位。

标签题单按标签 ID 聚合，一道题可出现在所关联的每个标签题单里。如果希望多个题库的同类题归到一起，使用相同的标签 ID。

每次发布都随包声明本包引用的标签、归档目录和全部祖先目录。

## 整理题面和题解

名称、标题等本地化字段使用 `zhCN` 和 `en`，至少提供一种语言。题目标题与题面须提供相同的语言，题解标题与题解正文也须提供相同的语言。题面和题解可分别选择提供哪些语言。

文件保存为 UTF-8 Markdown。题面可按题意、输入格式、输出格式、数据范围和样例组织。中英文版本应使用相同的变量、约束和样例。题解可以依次写思路、关键步骤、边界情况和复杂度。

省略题目的 `statement` 或题解的 `body` 时，应用按 `folder` 和对应标题的语言读取下表中的文件。

| 内容 | 中文文件 | 英文文件 |
| --- | --- | --- |
| 题面 | `<folder>/statement.zh-cn.md` | `<folder>/statement.en.md` |
| 只有一篇题解 | `<folder>/solution.zh-cn.md` | `<folder>/solution.en.md` |
| 有多篇题解 | `<folder>/solutions/<题解 ID>.zh-cn.md` | `<folder>/solutions/<题解 ID>.en.md` |

自定义文件名时，可以显式填写 `statement` 或 `body`，例如 `{ "zhCN": "range-sums/intro.md" }`。显式路径从题包根目录起算，使用 `/`，大小写与实际文件一致。所有正文路径都显式填写时，可以省略 `folder`。给原本只有一篇题解的题目增加第二篇时，也可以用显式 `body` 保留第一篇原有的文件名。

题包根目录内只放 `manifest.json` 和清单引用的 Markdown。附加说明或整理过程中的草稿放在题包目录外。

## 打包和发布更新

单个题库可以直接导入文件夹，也可以把清单和题目目录压成 ZIP。要一次交付多套题库，可以将它们分别放在外层文件夹的子目录，各子目录保留各自的 `manifest.json`。外层文件夹可直接导入或压成一个 ZIP。

单库最多 32 MiB、32,768 个文件。单次导入最多 128 MiB、131,072 个目录文件或 ZIP 条目。ZIP 同时受压缩文件大小和解压内容大小限制。

| 本次发布 | 清单设置 | 导入结果 |
| --- | --- | --- |
| 发整套题库 | `complete: true` | 旧版中本次缺席的题目和归档目录会被标记为下架。 |
| 只补充或修改一部分题目 | `complete: false` | 本次未列出的题目和目录继续保留。每道列出的题仍需提供完整题目定义，以及要保留的标签和题解。 |

发布更新时沿用 `libraryId`、`authorId` 和原题序号，递增 `releaseVersion`。同版本且解析内容一致可以重复导入。修改题面、标签或题解后，使用更高的发行版本。同版本内容冲突或版本更旧时，应用会拒绝导入。

## 发布前核对

- [ ] 在题库管理里导入目录或 ZIP，确认题库名称、整理者和发行版本。
- [ ] 逐题核对标题和正文的语言，并检查题面预览中的样例、公式和代码块。
- [ ] 检查题目的归档位置，对照清单核对每题引用的标签 ID。
- [ ] 发布更新前，用上一版试导入新版，核对新增、更新和下架数量。发布完整题包时，确认所有应保留的题目都写在清单中。

更多可直接导入的样板见 [基础算法示例](../examples/problem-libraries/example-basics) 和 [图论示例](../examples/problem-libraries/example-graphs)。
