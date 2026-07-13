import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

fs.rmSync("dist/npm", { recursive: true, force: true });
fs.mkdirSync("dist/npm", { recursive: true });

const common = {
  entryPoints: {
    index: "src/index.ts",
    domain: "src/domain/index.ts",
    "domain/perf": "src/domain/perf.ts",
    runtime: "src/runtime/index.ts",
    "runtime/modules": "src/runtime/modules/index.ts",
    "adapter/codemirror": "src/adapter/codemirror/index.ts"
  },
  bundle: true,
  platform: "neutral",
  target: "es2018",
  sourcemap: false,
  logLevel: "info",
  outdir: "dist/npm",
  external: [
    "@codemirror/state",
    "@codemirror/view"
  ]
};

await esbuild.build({
  ...common,
  format: "esm",
  outExtension: { ".js": ".mjs" }
});

await esbuild.build({
  ...common,
  format: "cjs",
  outExtension: { ".js": ".cjs" }
});

const tscBin = process.platform === "win32"
  ? ".\\node_modules\\.bin\\tsc.cmd"
  : "node_modules/.bin/tsc";

if (process.platform === "win32") {
  execFileSync("cmd", ["/c", tscBin, "-p", "tsconfig.package.json"], { stdio: "inherit" });
} else {
  execFileSync(tscBin, ["-p", "tsconfig.package.json"], { stdio: "inherit" });
}

writeModuleDeclarations("dist/npm/types");

console.log("core package built");

function writeModuleDeclarations(typesDir) {
  for (const declaration of collectDeclarationFiles(typesDir)) {
    const content = fs.readFileSync(declaration, "utf8");
    fs.writeFileSync(declaration.replace(/\.d\.ts$/, ".d.cts"), content);
    fs.writeFileSync(
      declaration.replace(/\.d\.ts$/, ".d.mts"),
      rewriteEsmDeclarationSpecifiers(content, declaration, typesDir)
    );
  }
}

function collectDeclarationFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDeclarationFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".d.ts")) files.push(fullPath);
  }
  return files;
}

function rewriteEsmDeclarationSpecifiers(content, declaration, typesDir) {
  return content.replace(/(from\s+["']|import\s*\(\s*["'])(\.{1,2}\/[^"']+)(["'])/g, (match, prefix, specifier, suffix) => {
    return `${prefix}${resolveEsmSpecifier(specifier, declaration, typesDir)}${suffix}`;
  });
}

function resolveEsmSpecifier(specifier, declaration, typesDir) {
  if (path.extname(specifier)) return specifier;
  const fromDir = path.dirname(declaration);
  const target = path.resolve(fromDir, ...specifier.split("/"));
  if (!isInside(target, typesDir)) return specifier;
  if (fs.existsSync(`${target}.d.ts`)) return `${specifier}.js`;
  if (fs.existsSync(path.join(target, "index.d.ts"))) return `${specifier}/index.js`;
  return specifier;
}

function isInside(target, parent) {
  const relative = path.relative(path.resolve(parent), target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
