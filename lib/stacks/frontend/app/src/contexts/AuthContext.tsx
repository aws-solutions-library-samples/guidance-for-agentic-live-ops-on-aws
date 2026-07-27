// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createContext, useEffect, useState, ReactNode } from "react";
import { Hub } from "aws-amplify/utils";
import {
    getCurrentUser,
    signOut,
    signInWithRedirect,
    fetchAuthSession,
    AuthSession,
} from "aws-amplify/auth";

interface AuthUser {
    username: string;
    userId: string;
}

export interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    signInRedirect: string;
    signIn: (redirect?: string) => Promise<void>;
    signOut: () => Promise<void>;

    //TODO: consider turning this into a state var that we manage with the Hub
    getAuthSession: () => Promise<AuthSession>;
}

interface AuthProviderProps {
    children: ReactNode;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: AuthProviderProps) => {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [signInRedirect, setSignInRedirect] = useState("");

    useEffect(() => {
        checkUser();
        setupAuthListener();
    }, []);

    const checkUser = async () => {
        try {
            const currentUser = await getCurrentUser();
            setUser({
                username: currentUser.username,
                userId: currentUser.userId,
            });
        } catch {
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    };

    const setupAuthListener = () => {
        Hub.listen("auth", (eventPayload) => {
            //console.log('hub.auth event:', eventPayload)

            const event = eventPayload.payload.event;
            let data = null;
            switch (event) {
                case "customOAuthState":
                    data = eventPayload.payload.data;
                    setSignInRedirect(data);
                    break;
                case "signedIn":
                    data = eventPayload.payload.data;
                    setUser({
                        username: data.username,
                        userId: data.userId,
                    });
                    break;
                case "signedOut":
                    setUser(null);
                    break;
                case "tokenRefresh":
                    checkUser();
                    break;
            }
        });
    };

    const handleSignIn = async (redirect?: string) => {
        try {
            await signInWithRedirect({ customState: redirect });
        } catch (error) {
            console.error("Error signing in:", error);
            throw error;
        }
    };

    const handleSignOut = async () => {
        try {
            await signOut();
            setUser(null);
        } catch (error) {
            console.error("Error signing out:", error);
            throw error;
        }
    };

    const handleGetAuthSession = async () => {
        try {
            const session = await fetchAuthSession();
            return session;
        } catch (error) {
            console.error("Error fetching auth session:", error);
            throw error;
        }
    };

    const contextValue = {
        user,
        isAuthenticated: !!user,
        isLoading,
        signInRedirect,
        signIn: handleSignIn,
        signOut: handleSignOut,
        getAuthSession: handleGetAuthSession,
    };

    if (isLoading) {
        return <div>Loading auth...</div>; // Or a loading spinner
    }

    return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
};
