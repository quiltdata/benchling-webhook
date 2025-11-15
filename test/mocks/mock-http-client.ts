/**
 * Mock HTTP Client for testing
 *
 * Allows tests to simulate HTTP responses without actual network calls.
 */

import { IHttpClient } from "../../lib/interfaces/aws-provider";

export class MockHttpClient implements IHttpClient {
    private responses: Map<string, unknown> = new Map();
    private errors: Map<string, Error> = new Map();
    private fetchedUrls: string[] = [];

    /**
     * Configure mock to return specific JSON for a URL
     */
    mockResponse(url: string, response: unknown): void {
        this.responses.set(url, response);
        this.errors.delete(url); // Clear any error for this URL
    }

    /**
     * Configure mock to throw an error for a URL
     */
    mockError(url: string, error: Error): void {
        this.errors.set(url, error);
        this.responses.delete(url); // Clear any response for this URL
    }

    /**
     * Get the list of URLs that were fetched
     */
    getFetchedUrls(): string[] {
        return [...this.fetchedUrls];
    }

    /**
     * Clear all fetched URLs history
     */
    clearHistory(): void {
        this.fetchedUrls = [];
    }

    async fetchJson(url: string): Promise<unknown> {
        this.fetchedUrls.push(url);

        if (this.errors.has(url)) {
            throw this.errors.get(url);
        }
        if (this.responses.has(url)) {
            return this.responses.get(url);
        }
        throw new Error(`No mock configured for URL: ${url}`);
    }

    /**
     * Reset all mocked data
     */
    reset(): void {
        this.responses.clear();
        this.errors.clear();
        this.fetchedUrls = [];
    }
}
