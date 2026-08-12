import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      // Se activara por etapas cuando los hooks legacy estabilicen sus
      // dependencias; TypeScript y las pruebas cubren el baseline actual.
      "react-hooks/exhaustive-deps": "off",
      "no-debugger": "error",
      "eqeqeq": ["error", "always"],
    },
  }
);
