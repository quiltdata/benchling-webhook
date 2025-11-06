/**
 * Utilities for working with SQS queue URLs.
 *
 * Provides helpers to validate whether a value looks like an SQS queue URL.
 */

const URL_REGEX = /^https:\/\/sqs\.[a-z0-9-]+\.amazonaws\.com\/\d{12}\/.+/i;

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
