import js from "@eslint/js";
import typescript from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

export default [
    {
        files: ["**/*.ts"],
        ignores: ["test/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
            },
            globals: {
                ...globals.node,
            },
        },
        plugins: {
            "@typescript-eslint": typescript,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...typescript.configs.recommended.rules,
            "quotes": ["error", "double"],
            "semi": ["error", "always"],
            "no-trailing-spaces": "error",
            "indent": ["error", 4],
            "comma-dangle": ["error", "always-multiline"],
            "@typescript-eslint/no-explicit-any": "error",
            "@typescript-eslint/explicit-function-return-type": "warn",
        },
    },
    {
        files: ["test/**/*.ts"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaVersion: "latest",
                sourceType: "module",
                project: "./tsconfig.json",
            },
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        plugins: {
            "@typescript-eslint": typescript,
        },
        rules: {
            ...js.configs.recommended.rules,
            ...typescript.configs.recommended.rules,
            "quotes": ["error", "double"],
            "semi": ["error", "always"],
            "no-trailing-spaces": "error",
            "indent": ["error", 4],
            "comma-dangle": ["error", "always-multiline"],
            "@typescript-eslint/no-explicit-any": "off", // Allow any in tests
            "@typescript-eslint/explicit-function-return-type": "off", // Don't require return types in tests
        },
    },
];
