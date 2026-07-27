// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import "@aws-amplify/ui-react/styles.css";
import "@cloudscape-design/global-styles/index.css";
import { Amplify } from "aws-amplify";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";

Amplify.configure(
    {
        Auth: {
            Cognito: {
                userPoolId: import.meta.env.VITE_USER_POOL_ID,
                userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID,
                identityPoolId: import.meta.env.VITE_IDENTITY_POOL_ID,
                allowGuestAccess: false,
                loginWith: {
                    oauth: {
                        domain: import.meta.env.VITE_USER_POOL_DOMAIN_URL,
                        scopes: ["openid"],
                        redirectSignIn: [
                            "http://localhost:3000",
                            import.meta.env.VITE_CALLBACK_URL,
                        ],
                        redirectSignOut: [
                            "http://localhost:3000",
                            import.meta.env.VITE_CALLBACK_URL,
                        ],
                        responseType: "code",
                    },
                },
            },
        },
        // Note: REST API removed - using direct streaming via Lambda Function URL
    }
    // Note: REST API configuration removed
);

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <AuthProvider>
            <App />
        </AuthProvider>
    </StrictMode>
);
