interface ProjectCredit {
  name: string;
  version: string;
  license: string;
}

export const frontendProjects = [
  { name: "React", version: "19.3.0", license: "MIT" },
  { name: "React DOM", version: "19.3.0", license: "MIT" },
  { name: "Tauri JavaScript API", version: "2.12.1", license: "Apache-2.0 OR MIT" },
  { name: "@codemirror/autocomplete", version: "6.20.4", license: "MIT" },
  { name: "@codemirror/commands", version: "6.11.1", license: "MIT" },
  { name: "@codemirror/lang-cpp", version: "6.0.3", license: "MIT" },
  { name: "@codemirror/lang-python", version: "6.2.1", license: "MIT" },
  { name: "@codemirror/language", version: "6.13.1", license: "MIT" },
  { name: "@codemirror/lint", version: "6.9.8", license: "MIT" },
  { name: "@codemirror/state", version: "6.7.6", license: "MIT" },
  { name: "@codemirror/view", version: "6.43.15", license: "MIT" },
  { name: "@lezer/common", version: "1.5.6", license: "MIT" },
  { name: "@lezer/cpp", version: "1.1.6", license: "MIT" },
  { name: "@lezer/highlight", version: "1.2.5", license: "MIT" },
  { name: "@lezer/lr", version: "1.4.12", license: "MIT" },
  { name: "@lezer/python", version: "1.1.19", license: "MIT" },
  { name: "react-markdown", version: "10.1.0", license: "MIT" },
  { name: "remark-gfm", version: "4.0.1", license: "MIT" },
  { name: "remark-math", version: "6.0.0", license: "MIT" },
  { name: "rehype-katex", version: "7.0.1", license: "MIT" },
  { name: "KaTeX", version: "0.19.1", license: "MIT" },
  { name: "@ungap/structured-clone", version: "1.4.0", license: "ISC" },
  { name: "hast-util-from-dom", version: "5.0.1", license: "ISC" },
  { name: "Fira Code", version: "6.2.0", license: "OFL-1.1" },
] as const satisfies readonly ProjectCredit[];

export const desktopProjects = [
  { name: "Tauri", version: "2.12.4", license: "Apache-2.0 OR MIT" },
  { name: "tauri-plugin-dialog", version: "2.8.4", license: "Apache-2.0 OR MIT" },
  { name: "tauri-plugin-single-instance", version: "2.5.5", license: "Apache-2.0 OR MIT" },
  { name: "chrono", version: "0.4.45", license: "MIT OR Apache-2.0" },
  { name: "env_filter", version: "2.1.0", license: "MIT OR Apache-2.0" },
  { name: "log", version: "0.4.34", license: "MIT OR Apache-2.0" },
  { name: "rolling-file", version: "0.2.0", license: "MIT OR Apache-2.0" },
  { name: "rusqlite", version: "0.40.2", license: "MIT" },
  { name: "libsqlite3-sys", version: "0.38.2", license: "MIT" },
  { name: "SQLite", version: "3.53.2", license: "Public domain" },
  { name: "serde", version: "1.0.229", license: "MIT OR Apache-2.0" },
  { name: "serde_json", version: "1.0.154", license: "MIT OR Apache-2.0" },
  { name: "sha2", version: "0.10.9", license: "MIT OR Apache-2.0" },
  { name: "tempfile", version: "3.27.0", license: "MIT OR Apache-2.0" },
  { name: "zip", version: "9.8.2", license: "MIT" },
] as const satisfies readonly ProjectCredit[];
