// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useAuth } from "./hooks/auth";
import Chat from "./pages/Chat";
import Monitor from "./pages/Monitor";
import Login from "./pages/Login";
import { I18nProvider } from "@cloudscape-design/components/i18n";
import messages from "@cloudscape-design/components/i18n/messages/all.en";
import { FlashbarProvider } from "./contexts/Flashbar";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Report } from "./services/monitor-service";
import Layout from "./components/Layout";

import { ConversationsProvider } from "./contexts/ConversationsContext";
import { MonitorProvider } from "./contexts/Monitor";

const LOCALE = "en";

/** Renders both pages but only displays the active one, keeping Monitor mounted.
 *  Layout is hoisted here so the shell (TopBar, AppLayout, SideBar) never remounts
 *  when switching between Chat and Monitor — eliminates the flicker. */
function AppRoutes() {
    const location = useLocation();
    const navigate = useNavigate();
    const [injectedPrompt, setInjectedPrompt] = useState<string | undefined>(undefined);
    const [injectedReport, setInjectedReport] = useState<Report | undefined>(undefined);

    const sendToChat = (prompt: string, report?: Report) => {
        setInjectedPrompt(prompt);
        setInjectedReport(report);
        navigate("/");
    };

    const chatContent = (
        <Chat
            injectedPrompt={injectedPrompt}
            injectedReport={injectedReport}
            onInjectedPromptConsumed={() => {
                setInjectedPrompt(undefined);
                setInjectedReport(undefined);
            }}
        />
    );

    const monitorContent = <Monitor onSendToChat={sendToChat} />;

    return (
        <Layout
            content={
                <>
                    <div style={{ display: location.pathname === "/" ? "block" : "none" }}>
                        {chatContent}
                    </div>
                    <div style={{ display: location.pathname === "/monitor" ? "block" : "none" }}>
                        {monitorContent}
                    </div>
                </>
            }
        />
    );
}

function App() {
    const auth = useAuth();

    if (!auth.isAuthenticated) {
        return <Login />;
    }

    return (
        <I18nProvider locale={LOCALE} messages={[messages]}>
            <FlashbarProvider>
                <ConversationsProvider>
                    <MonitorProvider>
                        <BrowserRouter>
                            <Routes>
                                <Route path="*" element={<AppRoutes />} />
                            </Routes>
                        </BrowserRouter>
                    </MonitorProvider>
                </ConversationsProvider>
            </FlashbarProvider>
        </I18nProvider>
    );
}

export default App;
