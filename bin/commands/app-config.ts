import { spawn } from "child_process";
import path from "path";

interface AppConfigOptions {
    profile?: string;
    eventType?: string;
}

export async function appConfigCommand(
    command: "inspect" | "seed" | "clear",
    options: AppConfigOptions,
): Promise<void> {
    const dockerDir = path.resolve(__dirname, "../../docker");
    const args = ["run", "python", "-m", "scripts.app_config", command, "--profile", options.profile || "default"];

    if (options.eventType) {
        args.push("--event-type", options.eventType);
    }

    await new Promise<void>((resolve, reject) => {
        const child = spawn("uv", args, {
            cwd: dockerDir,
            stdio: "inherit",
        });

        child.on("error", reject);
        child.on("close", code => {
            if (code === 0 || (command === "clear" && code === 2)) {
                resolve();
                return;
            }
            reject(new Error(`config:${command} failed with exit code ${code}`));
        });
    });
}
