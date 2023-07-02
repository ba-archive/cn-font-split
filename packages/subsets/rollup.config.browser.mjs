import analyze from "rollup-plugin-analyzer";
import json from "@rollup/plugin-json";
import common from "@rollup/plugin-commonjs";
import babel from "@rollup/plugin-babel";
import fse from "fs-extra";
import resolve from "@rollup/plugin-node-resolve";
import { createRequire } from "node:module";
import path from "node:path";
import alias from "@rollup/plugin-alias";
import condition from "@forsee/rollup-plugin-conditional";
import OMT from "@surma/rollup-plugin-off-main-thread";
import replace from "@rollup/plugin-replace";
const nodeAssets = await fse.readJson("./src/adapter/nodeAssets.json");

const require = createRequire(import.meta.url);

// 防止打包时删除 ts 的类型注解
fse.emptyDirSync("./dist/browser/");

// 传递一次静态文件
await Promise.all(
    [
        ...Object.values(nodeAssets)
            .filter((val) => {
                return ![".", "/"].includes(val[0]);
            })
            .map((v) => {
                let src;
                if (v[0] === "&") {
                    src = path.resolve("./dist", v.slice(1));
                } else {
                    src = require.resolve(v);
                }
                // console.log(src);
                return src;
            }),

        ...[
            "@chinese-fonts/wawoff2/build/compress_binding.wasm",
            "@chinese-fonts/wawoff2/build/decompress_binding.wasm",
            "@chinese-fonts/imagescript/dist/zlib.wasm",
            "@chinese-fonts/imagescript/dist/png.wasm",
            "@chinese-fonts/imagescript/dist/font.wasm",
        ].map((i) => require.resolve(i)),
    ].map((i) => {
        return fse.copy(i, "./dist/browser/" + path.basename(i));
    })
);
import { createTypeForBrowser } from "./scripts/createTypeForBrowser.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

createTypeForBrowser();
export default {
    input: "./src/index.ts",
    output: {
        dir: "./dist/browser",
        format: "es",
        globals: {
            process: "globalThis.process",
        },
        // sourcemap: true,
    },

    plugins: [
        OMT(),
        condition({ env: "browser" }),
        alias({
            entries: [{ find: "path", replacement: "path-browserify" }],
        }),
        json({
            namedExports: false,
        }),

        {
            id: "external",
            async resolveId(source, importer, options) {
                const external = ["imagescript", "module", "fs-extra"];

                if (external.includes(source) || source.startsWith("node:")) {
                    console.log(source);
                    return { id: source, external: true };
                }
            },
        },
        {
            name: "html",
            load: {
                order: "pre",

                handler(id) {
                    if (id.endsWith(".html")) {
                        const code = fse.readFileSync(id);
                        return {
                            code: `export default ${JSON.stringify(
                                code.toString("utf-8")
                            )}`,
                        };
                    }
                },
            },
        },
        common(),
        resolve({
            browser: true,
            extensions: [".ts", ".html", ".js", ".mjs"],
            // moduleDirectories: [],
            alias: {
                path: "path-browserify",
            },
            preferBuiltins: true,
        }),
        {
            transform(code, id) {
                // workerpool 源代码不支持 module worker，故自己改源码
                if (id.includes("workerpool")) {
                    // console.log("matched", id);
                    return code.replaceAll(
                        "new Worker(script)",
                        "new Worker(script,{type:globalThis.__worker__type__||'module'})"
                    );
                }
            },
        },
        babel({
            extensions: [".ts"],
            babelHelpers: "bundled",
        }),

        analyze({
            summaryOnly: true,
            writeTo: (str) =>
                fse.outputFileSync("dist/browser/index.analyze.txt", str),
        }),
    ],
};