export const codeLanguageOptions = [
  { value: "cpp", label: "C++" },
  { value: "python", label: "Python" },
] as const;

export type CodeLanguage = (typeof codeLanguageOptions)[number]["value"];
export const defaultCodeLanguage: CodeLanguage = "cpp";
