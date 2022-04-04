import { FontEditor, TTF, woff2 } from "fonteditor-core";
import { prepareCharset } from "./prepareCharset";
import { initWoff2, ReadFontDetail } from "./utils/FontUtils";
import fs from "fs";
import { formatBytes } from "./utils/formatBytes";
import format from "pretty-format";
import { genFontFile } from "./genFontFile";
import { CutTargetFont } from "./CutTargetFont";
import { Pool, spawn, Thread, Transfer, Worker } from "threads";
type InputTemplate = {
    FontPath: string;
    destFold: string;
    css: Partial<{
        fontFamily: string;
        fontWeight: string;
        fontStyle: string;
        fontDisplay: string;
    }>;
    fontType: FontEditor.FontType;
    cssFileName: string;
    chunkOptions: {
        TC?: number;
        SC?: number;
        other?: number;
    };
    charset: {
        SC?: boolean; // 简体
        other?: boolean; // 非中文及一些符号
        TC?: boolean; // 繁体
    };
    testHTML: boolean;
};

export default async function ({
    FontPath,
    destFold = "./build",
    css: {
        fontFamily = "",
        fontWeight = "",
        fontStyle = "",
        fontDisplay = "",
    } = {},
    fontType = "ttf",
    cssFileName = "result", // 生成 CSS 文件的名称
    chunkOptions = {}, //
    charset = {},
    testHTML = true,
}: InputTemplate) {
    charset = {
        SC: true, // 简体
        other: true, // 非中文及一些符号
        TC: false, // 繁体
        ...charset,
    };
    chunkOptions = {
        TC: 3,
        SC: 6,
        other: 1,
        ...chunkOptions,
    };
    const G = {} as Partial<
        {
            font: FontEditor.Font;
            Charset: ReturnType<typeof prepareCharset>;
            fontSlices: { [k: string]: string[][] };
            file: Buffer;
        } & TTF.Name
    >;
    const tra = [
        [
            "准备字符集",
            async () => {
                const Charset = await prepareCharset(charset);
                Object.assign(G, { Charset });
            },
        ],
        ["准备 woff2", () => initWoff2()],
        [
            "读取字体",
            async () => {
                let stat = fs.statSync(FontPath);
                const file = fs.readFileSync(FontPath);

                // // const { font, data } = ReadFontDetail(file, fontType);
                // console.log(data.name.fontFamily, formatBytes(stat.size));
                // Object.assign(G, { font, ...data.name, file });
                Object.assign(G, { file });
            },
        ],
        [
            "校对和切割目标字体",
            async () => {
                const fontSlices = await CutTargetFont(
                    G.Charset!,
                    chunkOptions
                );
                Object.assign(G, { fontSlices });
            },
        ],
        [
            "开始切割分包",
            async () => {
                Object.assign(G, { Charset: null });
                const { other = [], SC = [], TC = [] } = G.fontSlices!;
                const file = G.file!;
                const total = [...other, ...SC, ...TC];

                process.setMaxListeners(total.length * 6);
                console.log("总分包数目：", total.length);
                console.log("  已经开始分包了，请耐心等待。。。");
                const pool = Pool(
                    () => spawn(new Worker("./worker/genFontFile")),
                    8
                );
                console.time("切割总耗时");
                total.forEach((subset, index) => {
                    pool.queue(async (genFontFile) => {
                        const label =
                            "分包情况: " +
                            index +
                            " | 分字符集大小 | " +
                            subset.length;
                        console.time(label);
                        const result = await genFontFile(
                            file.buffer,
                            subset,
                            destFold,
                            fontType
                        );
                        console.timeEnd(label);
                        console.log(
                            "生成文件:",
                            result.id,
                            formatBytes(result.size)
                        );
                        Thread.terminate(genFontFile);
                        result;
                        return;
                    });
                });
                await pool.completed();
                await pool.terminate();
                console.timeEnd("切割总耗时");
                return;
            },
        ],
        //         [
        //             "生成 CSS 文件",
        //             async (charMap) => {
        //                 const IDCollection = charMap.get("开始切割分包");
        //                 const { fontFamily: ff } = charMap.get("读取字体");
        //                 const cssStyleSheet = IDCollection.map(({ id, subset }) => {
        //                     return `@font-face {
        //     font-family: ${fontFamily || ff};
        //     src: url("./${id}.woff2") format("woff2");
        //     font-style: ${fontStyle};
        //     font-weight: ${fontWeight};
        //     font-display: ${fontDisplay};
        //     unicode-range:${subset.map((i) => `U+${i.toString(16)}`).join(",")}
        // }`;
        //                 }).join("\n");
        //                 return fse.outputFile(
        //                     path.join(destFold, (cssFileName || "result") + ".css"),
        //                     cssStyleSheet
        //                 );
        //             },
        //         ],
        //         [
        //             "生成 Template.html 文件",
        //             (charMap) => {
        //                 if (testHTML) {
        //                     const { fontFamily: ff } = charMap.get("读取字体");

        //                     return createTestHTML({
        //                         fontFamily: fontFamily || ff,
        //                         cssFileName,
        //                         destFold,
        //                     });
        //                 }
        //             },
        //         ],
    ] as [string, Function][];

    return tra.reduce((col, [name, func]) => {
        console.time(name);
        return col
            .then(() => {
                return func();
            })
            .then(() => {
                console.timeEnd(name);
            });
    }, Promise.resolve());
}