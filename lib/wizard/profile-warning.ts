import chalk from "chalk";
import type { XDGBase } from "../xdg-base";

interface SetupProfileWarningInput {
    profile: string;
    explicitProfile: boolean;
    awsProfile?: string;
    configStorage: XDGBase;
}

export function maybeWarnAboutProfileConfusion(input: SetupProfileWarningInput): void {
    const { profile, explicitProfile, awsProfile, configStorage } = input;

    if (!explicitProfile || awsProfile || configStorage.profileExists(profile)) {
        return;
    }

    const awsProfileEnv = process.env.AWS_PROFILE?.trim();

    console.warn(chalk.yellow("\n⚠️  Profile selection warning"));
    console.warn(chalk.yellow(`   --profile '${profile}' selects a benchling-webhook config profile.`));
    console.warn(chalk.yellow(`   A new config profile '${profile}' will be created if setup continues.`));
    console.warn(chalk.yellow("   Use --aws-profile <name> or AWS_PROFILE to select AWS credentials."));
    if (awsProfileEnv) {
        console.warn(chalk.yellow(`   Current AWS credential source: AWS_PROFILE=${awsProfileEnv}`));
    }
    console.warn("");
}
