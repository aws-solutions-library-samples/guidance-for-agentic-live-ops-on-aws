// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface BrandingConfig {
    appTitle: string;
    logoUrl: string;
    faviconUrl: string;
    primaryColor: string;
    domainLabel: string;
}

export const DEFAULT_BRANDING: BrandingConfig = {
    appTitle: "Agentic Live Ops",
    logoUrl: "/favicon.png",
    faviconUrl: "/aws-smile.svg",
    primaryColor: "#0972d3",
    domainLabel: "gaming",
};

const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function parseBrandingConfig(): BrandingConfig {
    let parsed: Partial<BrandingConfig> = {};
    try {
        const raw = import.meta.env.VITE_BRANDING_CONFIG;
        if (raw) {
            parsed = JSON.parse(raw);
        }
    } catch {
        parsed = {};
    }

    const merged: BrandingConfig = { ...DEFAULT_BRANDING, ...parsed };

    if (!HEX_COLOR_REGEX.test(merged.primaryColor)) {
        merged.primaryColor = DEFAULT_BRANDING.primaryColor;
    }

    document.documentElement.style.setProperty("--app-primary-color", merged.primaryColor);

    return merged;
}

export const brandingConfig: BrandingConfig = parseBrandingConfig();
