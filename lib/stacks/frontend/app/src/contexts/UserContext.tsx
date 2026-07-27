// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import React, { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUserInfo } from "../common/utils/user-utils";

interface UserInfo {
    email: string;
    initials: string;
    name: string;
}

interface UserContextType {
    userInfo: UserInfo | null;
    isLoading: boolean;
}

const UserContext = createContext<UserContextType>({
    userInfo: null,
    isLoading: true,
});

export const useUser = () => {
    const context = useContext(UserContext);
    if (!context) {
        throw new Error("useUser must be used within a UserProvider");
    }
    return context;
};

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadUserInfo = async () => {
            try {
                const info = await getCurrentUserInfo();
                setUserInfo(info);
            } catch (error) {
                console.error("Failed to load user info:", error);
                setUserInfo({ email: "Unknown User", initials: "U", name: "Unknown User" });
            } finally {
                setIsLoading(false);
            }
        };

        loadUserInfo();
    }, []);

    return <UserContext.Provider value={{ userInfo, isLoading }}>{children}</UserContext.Provider>;
};
