// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
    fetchMonitorData,
    MonitorData,
    updateRule,
    requestAnalysis,
    PatternRule,
} from "../services/monitor-service";

interface MonitorContextValue {
    data: MonitorData | null;
    error: string | null;
    connected: boolean;
    isPolling: boolean;
    setIsPolling: (v: boolean) => void;
    timeRangeMinutes: number;
    setTimeRangeMinutes: (v: number) => void;
    updateRuleApi: (rule: PatternRule) => Promise<void>;
    requestAnalysisApi: typeof requestAnalysis;
}

const MonitorContext = createContext<MonitorContextValue | null>(null);

const POLL_INTERVAL = 5_000;
const REPORT_LIMIT = 50;

export function MonitorProvider({ children }: { children: React.ReactNode }) {
    const [data, setData] = useState<MonitorData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);
    const [isPolling, setIsPolling] = useState(true);
    const [timeRangeMinutes, setTimeRangeMinutes] = useState(60);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const poll = useCallback(async () => {
        try {
            const result = await fetchMonitorData(timeRangeMinutes, REPORT_LIMIT);
            setData(result);
            setError(null);
            setConnected(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
            setConnected(false);
        }
    }, [timeRangeMinutes]);

    useEffect(() => {
        if (!isPolling) {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
            return;
        }

        poll();
        timerRef.current = setInterval(poll, POLL_INTERVAL);

        return () => {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        };
    }, [isPolling, poll]);

    return (
        <MonitorContext.Provider
            value={{
                data,
                error,
                connected,
                isPolling,
                setIsPolling,
                timeRangeMinutes,
                setTimeRangeMinutes,
                updateRuleApi: updateRule,
                requestAnalysisApi: requestAnalysis,
            }}
        >
            {children}
        </MonitorContext.Provider>
    );
}

export function useMonitorContext() {
    const ctx = useContext(MonitorContext);
    if (!ctx) throw new Error("useMonitorContext must be used within MonitorProvider");
    return ctx;
}
