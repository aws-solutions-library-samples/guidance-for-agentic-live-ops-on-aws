// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React from "react";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Title,
    Tooltip,
    Legend,
} from "chart.js";
import { Bar, Line, Pie, Doughnut } from "react-chartjs-2";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";

// Register Chart.js components
ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    LineElement,
    PointElement,
    ArcElement,
    Title,
    Tooltip,
    Legend
);

interface ChartData {
    type: "bar" | "line" | "pie" | "doughnut";
    title: string;
    labels: string[];
    data: number[];
}

interface ChartComponentProps {
    chartData: ChartData;
}

const ChartComponent: React.FC<ChartComponentProps> = ({ chartData }) => {
    const { type, title, labels, data } = chartData;

    // Generate colors for the chart
    const generateColors = (count: number) => {
        const colors = [
            "rgba(54, 162, 235, 0.8)",
            "rgba(255, 99, 132, 0.8)",
            "rgba(255, 205, 86, 0.8)",
            "rgba(75, 192, 192, 0.8)",
            "rgba(153, 102, 255, 0.8)",
            "rgba(255, 159, 64, 0.8)",
            "rgba(199, 199, 199, 0.8)",
            "rgba(83, 102, 255, 0.8)",
        ];

        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(colors[i % colors.length]);
        }
        return result;
    };

    const borderColors = generateColors(data.length).map((color) => color.replace("0.8", "1"));

    const chartConfig = {
        labels,
        datasets: [
            {
                label: title,
                data,
                backgroundColor: generateColors(data.length),
                borderColor: borderColors,
                borderWidth: 1,
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: "top" as const,
            },
            title: {
                display: false, // We'll use Cloudscape header instead
            },
        },
        scales:
            type === "pie" || type === "doughnut"
                ? undefined
                : {
                      y: {
                          beginAtZero: true,
                      },
                  },
    };

    const renderChart = () => {
        const commonProps = {
            data: chartConfig,
            options: options,
        };

        switch (type) {
            case "bar":
                return <Bar {...commonProps} />;
            case "line":
                return <Line {...commonProps} />;
            case "pie":
                return <Pie {...commonProps} />;
            case "doughnut":
                return <Doughnut {...commonProps} />;
            default:
                return <Bar {...commonProps} />;
        }
    };

    return (
        <Container header={<Header variant="h3">{title}</Header>}>
            <Box padding="m">
                <div
                    style={{ height: "400px", width: "100%" }}
                    data-testid={`chart-${type}`}
                    className="chart-container"
                    data-chart-title={title}
                >
                    {renderChart()}
                </div>
            </Box>
        </Container>
    );
};

export default ChartComponent;
