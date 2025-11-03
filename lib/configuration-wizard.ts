import inquirer from "inquirer";

/**
 * Configuration wizard options
 */
export interface WizardOptions {
    partialConfig?: Record<string, string | number | boolean>;
}

/**
 * Configuration field definition
 */
interface ConfigField {
    name: string;
    message: string;
    type: "input" | "password";
    validate?: (value: string) => boolean | string;
    optional?: boolean;
}

/**
 * Interactive configuration wizard for completing missing configuration details
 */
export class ConfigurationWizard {
    /**
     * Required configuration fields
     */
    private static readonly REQUIRED_FIELDS: ConfigField[] = [
        {
            name: "benchlingTenant",
            message: "Enter your Benchling tenant name (e.g., 'acme' for acme.benchling.com):",
            type: "input",
            validate: ConfigurationWizard.validateTenant,
        },
        {
            name: "benchlingClientId",
            message: "Enter your Benchling OAuth client ID:",
            type: "input",
            validate: ConfigurationWizard.validateClientId,
        },
        {
            name: "benchlingClientSecret",
            message: "Enter your Benchling OAuth client secret:",
            type: "password",
            validate: ConfigurationWizard.validateClientSecret,
        },
        {
            name: "benchlingAppDefinitionId",
            message: "Enter your Benchling app definition ID:",
            type: "input",
            validate: ConfigurationWizard.validateAppDefinitionId,
        },
    ];

    /**
     * Optional configuration fields
     */
    private static readonly OPTIONAL_FIELDS: ConfigField[] = [
        {
            name: "benchlingTestEntry",
            message: "Enter a Benchling test entry ID (optional, press Enter to skip):",
            type: "input",
            optional: true,
        },
    ];

    /**
     * Run the configuration wizard
     */
    public static async run(options: WizardOptions): Promise<Record<string, string | number | boolean>> {
        const { partialConfig = {} } = options;

        try {
            // Identify missing required fields
            const missingFields = ConfigurationWizard.getMissingFields(partialConfig);

            // If no fields are missing, return the partial config
            if (missingFields.length === 0) {
                return partialConfig;
            }

            // Create prompt questions for missing fields
            const questions = ConfigurationWizard.createQuestions(missingFields);

            // Prompt the user for missing fields
            const answers = await inquirer.prompt(questions);

            // Validate the answers
            ConfigurationWizard.validateAnswers(answers);

            // Merge answers with partial config
            const completeConfig = { ...partialConfig };

            // Add non-empty answers
            for (const [key, value] of Object.entries(answers)) {
                if (value && typeof value === "string" && value.trim() !== "") {
                    completeConfig[key] = value;
                }
            }

            return completeConfig;
        } catch (error) {
            if (error instanceof Error && error.message === "User cancelled") {
                throw new Error("Configuration wizard cancelled");
            }
            throw error;
        }
    }

    /**
     * Get missing required fields from partial configuration
     */
    public static getMissingFields(partialConfig: Record<string, string | number | boolean | undefined>): string[] {
        const missingFields: string[] = [];

        for (const field of ConfigurationWizard.REQUIRED_FIELDS) {
            if (!partialConfig[field.name] || partialConfig[field.name] === "") {
                missingFields.push(field.name);
            }
        }

        return missingFields;
    }

    /**
     * Create inquirer questions for missing fields
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private static createQuestions(missingFields: string[]): any[] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const questions: any[] = [];

        // Add questions for missing required fields
        for (const field of ConfigurationWizard.REQUIRED_FIELDS) {
            if (missingFields.includes(field.name)) {
                questions.push({
                    type: field.type,
                    name: field.name,
                    message: field.message,
                    validate: field.validate ? (input: string): boolean | string => {
                        const result = field.validate!(input);
                        return result === true ? true : (result as string);
                    } : undefined,
                });
            }
        }

        // Add optional fields
        for (const field of ConfigurationWizard.OPTIONAL_FIELDS) {
            questions.push({
                type: field.type,
                name: field.name,
                message: field.message,
            });
        }

        return questions;
    }

    /**
     * Validate answers after prompting
     */
    private static validateAnswers(answers: Record<string, string>): void {
        // Check for empty tenant
        if (answers.benchlingTenant !== undefined &&
            (answers.benchlingTenant === "" || answers.benchlingTenant.trim() === "")) {
            throw new Error("Benchling tenant cannot be empty");
        }

        // Check for empty client ID
        if (answers.benchlingClientId !== undefined && answers.benchlingClientId === "") {
            throw new Error("Benchling client ID cannot be empty");
        }

        // Check for empty client secret
        if (answers.benchlingClientSecret !== undefined && answers.benchlingClientSecret === "") {
            throw new Error("Benchling client secret cannot be empty");
        }

        // Check for empty app definition ID
        if (answers.benchlingAppDefinitionId !== undefined && answers.benchlingAppDefinitionId === "") {
            throw new Error("Benchling app definition ID cannot be empty");
        }
    }

    /**
     * Validate Benchling tenant format
     */
    public static validateTenant(value: string): boolean | string {
        if (!value || value.trim() === "") {
            return "Benchling tenant cannot be empty";
        }
        return true;
    }

    /**
     * Validate Benchling client ID format
     */
    public static validateClientId(value: string): boolean | string {
        if (!value || value.trim() === "") {
            return "Client ID cannot be empty";
        }
        return true;
    }

    /**
     * Validate Benchling client secret format
     */
    public static validateClientSecret(value: string): boolean | string {
        if (!value || value.trim() === "") {
            return "Client secret cannot be empty";
        }
        if (value.length < 6) {
            return "Client secret must be at least 6 characters";
        }
        return true;
    }

    /**
     * Validate Benchling app definition ID format
     */
    public static validateAppDefinitionId(value: string): boolean | string {
        if (!value || value.trim() === "") {
            return "App definition ID cannot be empty";
        }
        return true;
    }
}
