// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createHtmlPlugin } from "vite-plugin-html";

// Parse branding config from build-time env var with safe fallbacks
function getBrandingValues() {
    const raw = process.env.VITE_BRANDING_CONFIG;
    try {
        if (raw) {
            const config = JSON.parse(raw);
            return {
                appTitle: config.appTitle || "Agentic Live Ops",
                faviconUrl: config.faviconUrl || "/aws-smile.svg",
            };
        }
    } catch {
        // Invalid JSON — fall through to defaults
    }
    return {
        appTitle: "Agentic Live Ops",
        faviconUrl: "/aws-smile.svg",
    };
}

const { appTitle, faviconUrl } = getBrandingValues();

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        createHtmlPlugin({
            inject: {
                data: {
                    VITE_APP_TITLE: appTitle,
                    VITE_FAVICON_URL: faviconUrl,
                },
            },
        }),
    ],
});
