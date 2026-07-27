// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";

import { I18nProvider } from "@cloudscape-design/components/i18n";
import enMessages from "@cloudscape-design/components/i18n/messages/all.en.json";

import { CustomAppLayout, Notifications } from "../commons/common-components";
import Chat from "./chat";
import { Message } from "./config";

import "../../styles/base.scss";

function App() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isQuestionSelectorVisible, setIsQuestionSelectorVisible] = useState(false);
    const messagesContainerRef = useRef<HTMLDivElement>(null);

    return (
        <I18nProvider locale="en" messages={[enMessages]}>
            <CustomAppLayout
                maxContentWidth={1280}
                toolsHide
                navigationHide
                content={
                    <Chat
                        messages={messages}
                        setMessages={setMessages}
                        isQuestionSelectorVisible={isQuestionSelectorVisible}
                        setIsQuestionSelectorVisible={setIsQuestionSelectorVisible}
                        messagesContainerRef={messagesContainerRef}
                    />
                }
                notifications={<Notifications />}
            />
        </I18nProvider>
    );
}

createRoot(document.getElementById("app")!).render(<App />);
