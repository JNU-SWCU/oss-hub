import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import typescriptParser from "@typescript-eslint/parser";

// docs/rules/frontend.md — 의존 방향은 app → features → lib 단방향이며,
// feature는 다른 feature의 내부 경로에 직접 의존하지 않는다.
// featureNames는 src/features의 실제 폴더를 읽어 생성하므로 새 feature가
// 추가돼도 이 파일을 손대지 않고 규칙이 자동으로 확장된다.
const featuresDir = path.join(import.meta.dirname, "src/features");
const featureNames = fs.existsSync(featuresDir)
  ? fs
      .readdirSync(featuresDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

const appReverseDependencyBan = {
  group: ["@/app", "@/app/**"],
  message:
    "features는 app에 의존할 수 없다 — 의존 방향은 app → features → lib 단방향이다 (docs/rules/frontend.md).",
};

const featureBoundaryConfigs = featureNames.map((name) => {
  const otherFeatureGroups = featureNames
    .filter((other) => other !== name)
    .flatMap((other) => [`@/features/${other}`, `@/features/${other}/**`]);

  return {
    files: [`src/features/${name}/**/*.{ts,tsx}`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...(otherFeatureGroups.length > 0
              ? [
                  {
                    group: otherFeatureGroups,
                    message:
                      "feature 간 직접 의존 금지 — 공용 계약은 명시적으로 추출한다 (docs/rules/frontend.md).",
                  },
                ]
              : []),
            appReverseDependencyBan,
          ],
        },
      ],
    },
  };
});

const libBoundaryConfig = {
  files: ["src/lib/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/features", "@/features/**"],
            message:
              "lib은 최하위 계층이다 — features에 의존할 수 없다 (docs/rules/frontend.md).",
          },
          appReverseDependencyBan,
        ],
      },
    ],
  },
};

export default defineConfig([
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: nextPlugin.configs.recommended.rules,
  },
  ...featureBoundaryConfigs,
  libBoundaryConfig,
  {
    ignores: [".next/**", "coverage/**", "node_modules/**"],
  },
]);
