import * as path from "path";
import * as fs from "fs";
import { Compiler, NormalModule, WebpackPluginInstance } from "webpack";
import { minimatch } from "minimatch";
import { PluginOptions } from "../types";

class WebpackWorkersPlugin implements WebpackPluginInstance {
    private options: Required<PluginOptions>;

    constructor(options: PluginOptions = {}) {
        this.options = {
            srcDir: options.srcDir || "src",
            publicDir: options.publicDir || "public",
            extensions: options.extensions || [".js", ".ts"],
            dirs: options.dirs || ["workers", "worklets"],
            minify: options.minify ?? process.env.NODE_ENV === "production",
        };
    }

    apply(compiler: Compiler): void {
        console.log("WebpackWorkersPlugin under development");
    }
}

export default WebpackWorkersPlugin;
