// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { getCurrentUser } from "aws-amplify/auth";

/**
 * Extracts initials from an email address or username
 * @param email - The email address or username
 * @returns The first letter of the email/username in uppercase
 */
export function getInitialsFromEmail(email: string): string {
    if (!email) return "U";

    // If it's an email, get the part before @
    const username = email.includes("@") ? email.split("@")[0] : email;

    // Return the first letter, uppercase
    return username.charAt(0).toUpperCase();
}

/**
 * Gets the current user's email and generates initials
 * @returns Promise with user email and initials
 */
export async function getCurrentUserInfo(): Promise<{
    email: string;
    initials: string;
    name: string;
}> {
    try {
        const user = await getCurrentUser();
        const email = user.signInDetails?.loginId || user.username;
        const initials = getInitialsFromEmail(email);

        // Extract name from email (part before @) or use email as fallback
        const name = email.includes("@") ? email.split("@")[0] : email;

        return { email, initials, name };
    } catch (error) {
        console.error("Failed to get user info:", error);
        return { email: "Unknown User", initials: "U", name: "Unknown User" };
    }
}
