/**
 * Utilities for working with SQS identifiers.
 *
 * Provides helpers to normalize queue identifiers to URLs and to validate
 * whether a value looks like an SQS queue URL.
 */

const ARN_REGEX = /^arn:aws:sqs:([a-z0-9-]+):(\d{12}):(.+)$/i;
const URL_REGEX = /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/.+/i;

/**
 * Normalize a queue identifier (ARN or URL) to an SQS queue URL.
 *
 * @param identifier - Queue ARN or URL
 * @returns Queue URL (or original value if it cannot be normalized)
 */
export function toQueueUrl(identifier: string | undefined | null): string | undefined {
    if (!identifier) {
        return identifier ?? undefined;
    }

    const trimmed = identifier.trim();
    if (trimmed.length === 0) {
        return undefined;
    }

    if (isQueueUrl(trimmed)) {
        return trimmed;
    }

    const match = trimmed.match(ARN_REGEX);
    if (!match) {
        return trimmed;
    }

    const [, region, account, queueName] = match;
    return `https://sqs.${region}.amazonaws.com/${account}/${queueName}`;
}

/**
 * Check whether a string appears to be an SQS queue URL.
 *
 * @param value - Value to validate
 * @returns True if the value matches the expected SQS URL pattern
 */
export function isQueueUrl(value: string | undefined | null): boolean {
    if (!value) {
        return false;
    }
    return URL_REGEX.test(value.trim());
}
