// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { TopNavigation } from "@cloudscape-design/components";
import { applyMode, Mode } from "@cloudscape-design/global-styles";
import { signOut } from "aws-amplify/auth";
import { useEffect, useState } from "react";
import AboutModal from "./AboutModal.tsx";
import { useUser } from "../../../contexts/UserContext";
import { brandingConfig } from "../../../common/brandingConfig";

const TopBar = () => {
    const [theme, setTheme] = useState<Mode>(() => {
        const savedTheme = localStorage.getItem("theme");
        return savedTheme === "dark" ? Mode.Dark : Mode.Light;
    });

    useEffect(() => {
        localStorage.setItem("theme", theme);
        applyMode(theme);
    }, [theme]);

    const [showAboutModal, setShowAboutModal] = useState(false);
    const { userInfo } = useUser();

    const email = userInfo?.email || "";

    return (
        <div
            style={{
                borderBottom: `2px solid var(--app-primary-color)`,
            }}
        >
            <TopNavigation
                identity={{
                    href: "/",
                    title: brandingConfig.appTitle,
                    logo: {
                        src: brandingConfig.logoUrl,
                        alt: brandingConfig.appTitle,
                    },
                }}
                utilities={[
                    {
                        type: "menu-dropdown",
                        iconName: "settings",
                        ariaLabel: "Settings",
                        title: "Settings",
                        onItemClick: ({ detail }) => {
                            if (detail.id === "switch-theme") {
                                setTheme(theme === Mode.Light ? Mode.Dark : Mode.Light);
                            } else if (detail.id === "about") {
                                setShowAboutModal(true);
                            }
                        },
                        items: [
                            {
                                id: "switch-theme",
                                text: theme === Mode.Light ? "🌑  Dark Theme" : "☀️ Light Theme",
                            },
                            {
                                id: "about",
                                text: "About",
                            },
                        ],
                    },
                    {
                        type: "menu-dropdown",
                        iconName: "user-profile",
                        items: [
                            {
                                id: "user",
                                text: email,
                                items: [{ id: "signout", text: "Sign out" }],
                            },
                        ],
                        onItemClick: async ({ detail }) => {
                            if (detail.id === "signout") {
                                try {
                                    await signOut();
                                } catch (error) {
                                    console.log("Failed to sign out: ", error);
                                }
                            }
                        },
                    },
                ]}
            />
            <AboutModal
                visible={showAboutModal}
                onDismiss={() => setShowAboutModal(false)}
                appName={brandingConfig.appTitle}
            />
        </div>
    );
};

export default TopBar;
