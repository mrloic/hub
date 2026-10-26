import js from "@eslint/js";
import ts from "typescript-eslint";
export default ts.config(
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/rnnoise.generated.js", "**/release/**"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "error",
    },
  },
);
