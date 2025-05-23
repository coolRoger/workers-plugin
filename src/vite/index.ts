import { build } from "vite";
import { resolve, dirname, relative, basename, extname } from "path";
import { promises as fs } from "fs";
import { createFilter } from "@rollup/pluginutils";
import { PluginOptions } from "../types";

export default function ViteWorkersBundlerPlugin(options: PluginOptions = {}) {
    const {
        srcDir = "src",
        publicDir = "public",
        extensions = [".js", ".ts"],
        dirs = ["workers", "worklets"],
    } = options;

    const srcDirs = dirs.map((dir) => resolve(process.cwd(), srcDir, dir));
    const destDirs = dirs.map((dir) => resolve(process.cwd(), publicDir, dir));

    const dirMapping = srcDirs.reduce((acc, srcDir, i) => {
        acc[srcDir] = { src: srcDir, dest: destDirs[i], name: dirs[i] };
        return acc;
    }, {} as Record<string, { src: string; dest: string; name: string }>);

    const filter = createFilter(dirs.map((dir) => `${srcDir}/${dir}/**/*+(${extensions.join("|")})`));

    async function ensureDirectoryExists(dir: string) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    async function processFile(file: string) {
        let sourceDir = null;
        let targetDir = null;

        for (const srcDir of srcDirs) {
            if (file.startsWith(srcDir)) {
                sourceDir = srcDir;
                targetDir = dirMapping[srcDir].dest;
                break;
            }
        }

        if (!sourceDir || !targetDir) {
            console.warn(`Cannot determine target directory for file: ${file}`);
            return;
        }

        const relativePath = relative(sourceDir, file);
        const outputPath = resolve(targetDir, relativePath.replace(/\.(js|ts)$/, ".js"));

        try {
            await ensureDirectoryExists(dirname(outputPath));

            const result = await build({
                configFile: false,
                build: {
                    write: false,
                    lib: { entry: file, formats: ["es"] },
                    rollupOptions: {
                        external: [],
                        output: { entryFileNames: basename(outputPath) },
                    },
                    minify: process.env.NODE_ENV === "production",
                },
            });

            if (Array.isArray(result)) {
                const output = result[0].output[0];
                await fs.writeFile(outputPath, output.code);
                console.log(`Built ${file} -> ${outputPath}`);
            }
        } catch (error) {
            console.error(`Error building ${file}:`, error);
        }
    }

    async function processDirectory(dir: string) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });

            for (const entry of entries) {
                const entryPath = resolve(dir, entry.name);

                if (entry.isDirectory()) {
                    await processDirectory(entryPath);
                } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
                    await processFile(entryPath);
                }
            }
        } catch (error: any) {
            if (error.code !== "ENOENT") {
                console.error(`Error processing directory ${dir}:`, error);
            }
        }
    }

    async function fileExists(filePath: string) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async function checkOrphanFiles(srcDir: string, publicDir: string) {
        try {
            const entries = await fs.readdir(publicDir, { withFileTypes: true });

            for (const entry of entries) {
                const entryPath = resolve(publicDir, entry.name);

                if (entry.isDirectory()) {
                    await checkOrphanFiles(resolve(srcDir, entry.name), entryPath);
                } else if (entry.isFile() && extname(entry.name) === ".js") {
                    const rel = relative(publicDir, entryPath).replace(/\.js$/, "");

                    let hasSource = false;
                    for (const ext of extensions) {
                        const srcFile = resolve(srcDir, `${rel}${ext}`);
                        if (await fileExists(srcFile)) {
                            hasSource = true;
                            break;
                        }
                    }

                    if (!hasSource) {
                        console.warn(`[vite-workers-plugin] Orphaned file: ${entryPath}`);
                    }
                }
            }
        } catch (err: any) {
            if (err.code !== "ENOENT") {
                console.error(`[vite-workers-plugin] Error checking ${publicDir}:`, err);
            }
        }
    }

    return {
        name: "vite-workers-bundler-plugin",

        async buildStart() {
            for (const dir of destDirs) {
                await ensureDirectoryExists(dir);
            }
            for (const dir of srcDirs) {
                await processDirectory(dir);
            }
        },

        watchChange(id: string) {
            // const isTargetFile = srcDirs.some(
            //     (dir) => id.startsWith(dir) && extensions.some((ext) => id.endsWith(ext))
            // );

            const isTargetFile = filter(id);

            if (isTargetFile) {
                processFile(id);
                console.log(`[vite-workers-plugin] rebuilt on change: ${id}`);
            }
        },

        async buildEnd() {
            console.log("[vite-workers-plugin] Checking for orphaned public files...");
            for (let i = 0; i < dirs.length; i++) {
                await checkOrphanFiles(srcDirs[i], destDirs[i]);
            }
            console.log("[vite-workers-plugin] Orphan check done.");
        },
    };
}
