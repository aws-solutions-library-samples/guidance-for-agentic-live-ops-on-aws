// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Question, QuestionCategory } from "./types";

// Canonical question catalog shown in the UI. Edit here to change what users see.
const questionsData = `# Agentic Live Ops - Sample Questions

This document provides sample questions you can ask the Agentic Live Ops system, organized by agent type and use case. The system uses the Agentic Live Ops orchestrator to route your questions to the most appropriate specialized agent.

**Data Coverage**: July 2025 - October 2025  
**Player Base**: ~1,000 total players across multiple countries  
**Available Data**: Player profiles, purchase history, gameplay sessions, campaigns, character interactions, guild activities

## 🎯 **DEMO JOURNEY - Guided Question Flow**

**Purpose**: Complete demo experience showcasing all Agentic Live Ops capabilities through a structured journey from discovery to strategic recommendations.

### 1. Top Spenders Analysis
- "Who are the Top Spenders? Calculate their ARPU (Average Revenue Per User) and give me the results of that calculation in a table and a chart"

### 2. Spending Trends Analysis
- "What are three trends I should know about my spenders?"

### 3. Segmentation Strategy
- "Can you tell me how I should consider segmenting these payer groups further? Can you create a graph that shows me how big these groups would be?"

### 4. Targeted Messaging & Sales Strategy
- "I want to use these new segments to sell new items coming to the game. What messages should I use to convey this strategy for each segment? Can you give me 1 message per segment and what should I sell?"

### 5. Campaign Impact Projections
- "What should I expect as a result of this campaign? Give me estimated uplifts and what KPIs it impacts"

### 6. Additional Recommendations
- "What else would you recommend for this campaign I haven't considered?"

## 🎓 Tutorial Analysis Agent

**Purpose**: Analyzes the branching new-player tutorial: funnels, drop-off, step orders, retry loops, and which paths lead to better retention (synthetic cohort of new installs, September - October 2025).

### Funnel & Drop-off
- "Show me the tutorial funnel: how many players reach each step and where do they drop off?"
- "Which tutorial step has the highest quit rate, and how long do players spend on it?"
- "Did tutorial version v2 reduce drop-off compared to v1?"

### Paths & Branches
- "What are the most common orders players take through the tutorial modules, and how does each order affect completion?"
- "Build the step-to-step transition graph for the tutorial and highlight loops and dead ends"
- "Does the module players choose first at the hub change their chance of finishing the tutorial?"

### Tutorial & Retention
- "Which tutorial branch leads to better D7 retention?"
- "Do players who skip the optional crafting or social modules retain worse at D7?"
- "Do players who fail the first battle multiple times churn more?"

## 🎯 Player Character Targeting Agent

**Purpose**: Analyzes character acquisition patterns and predicts player targeting preferences based on actual player data.

### Character Acquisition Analysis (Based on Real Data)
- "Which characters have the highest acquisition rates among iOS vs Android players?"
- "Show me the top 5 characters being acquired by whale players (player segments: whale)"
- "What characters are F2P hardcore players (segment: f2p_hardcore) focusing on?"
- "Analyze character targeting patterns for players with legendary heroes unlocked"
- "Which characters show the strongest correlation with player level progression?"

### Platform-Specific Character Preferences
- "Compare character acquisition costs between iOS and Android platforms"
- "Which characters are most popular among players in different countries (US, UK, CA, DE, JP, AU, KR, BR, IN, FR)?"
- "Show character preference differences between new players (level 25) and endgame players (level 85)"
- "Analyze relic upgrade patterns for top characters like Zephyr Nightshade, Kael Shadowborn, Vex Ironheart"

### Legendary Heroes & High-Value Characters
- "Which legendary heroes (Zephyr Nightshade, Kael Shadowborn, Vex Ironheart, Ryn Stormweaver, Lyra Dawnblade, Moros Darkwhisper, Nova Starwind, Sage Elderwood, Theron Voidwalker, Orion Lightbringer) have the highest unlock rates?"
- "What's the average time between legendary hero unlocks for whale players?"
- "Analyze the progression path from first legendary hero to multiple legendary hero ownership"
- "Which characters do players typically unlock after getting their first legendary hero?"

## 📊 Player Segmentation Agent

**Purpose**: Creates segments based on actual player behavior patterns from the player database.

### Segment Analysis (Based on Real Player Data)
- "Analyze the characteristics of our current player segments: whale, dolphin, f2p_hardcore, casual"
- "What are the spending patterns and character preferences for each segment?"
- "Show me the progression timeline from casual to whale segments"
- "Which segments have the highest arena rankings and combat power?"

### Geographic & Platform Segmentation
- "Compare player segments across countries: US, UK, CA, DE, JP, AU, KR, BR, IN, FR"
- "How do iOS vs Android players distribute across spending segments?"
- "Which geographic regions have the highest concentration of whale players?"
- "Analyze guild participation patterns across different player segments (guild_silver_phoenixes, guild_crimson_legion, guild_iron_vanguard, guild_shadow_mercenaries, guild_emerald_resistance, guild_sapphire_guardians)"

### Behavioral Pattern Analysis
- "What combat power ranges define each player segment?"
- "How many legendary heroes do players in each segment typically own?"
- "Analyze character collection patterns by segment (characters owned count)"
- "Which segments show the highest relic upgrade activity?"

## 🚀 Acquisition Optimization Agent

**Purpose**: Analyzes actual campaign performance data to optimize user acquisition.

### Campaign Performance Analysis (Real Campaign Data)
- "Analyze the performance of our current campaigns: Summer Legends Event, New Player Welcome, Holiday Special Offer, Arena Championship, Guild Wars Promotion"
- "Compare budgets and performance across Facebook, Google, and Unity Ads platforms"
- "Which campaigns target returning players vs new players vs whales?"
- "Show me the budget allocation for each acquisition campaign"

### Creative & Targeting Optimization
- "Analyze the performance of different campaign types: acquisition vs retention"
- "Which targeting strategies (returning_players, new_players, all_players, whales) perform best?"
- "Compare performance across different channels (search_engine, facebook, mobile_ads)"
- "What's the optimal budget allocation across our current campaigns?"

### Cohort & Quality Analysis
- "Which campaigns deliver users with the highest arena participation rates?"
- "Analyze first purchase rates and average purchase amounts by campaign"
- "Compare whale conversion rates across different acquisition sources"
- "Which campaigns show the best guild join rates and engagement?"

## 🆓 Free-to-Play Analysis Agent

**Purpose**: Analyzes never-spender player patterns and engagement behaviors.

### F2P Player Behavior Analysis
- "Analyze the play patterns of our free-to-play players who never spend"
- "What keeps F2P players engaged without making purchases?"
- "Compare session frequency and duration between F2P and paying players"
- "Which content do F2P players engage with most?"

### F2P Retention & Engagement
- "What are the retention rates for never-spending players?"
- "Analyze F2P player progression patterns and level advancement"
- "Which F2P players are at risk of churning?"
- "How do F2P players contribute to the game ecosystem?"

### F2P Conversion Opportunities
- "Identify F2P players most likely to make their first purchase"
- "What triggers could convert long-term F2P players?"
- "Analyze the value F2P players provide through social interactions"
- "Which F2P segments show potential for monetization?"

## 📈 Performance Metrics Agent

**Purpose**: Provides KPI analysis based on actual performance data.

### Core KPI Analysis (Real Metrics Data)
- "Show me our current ARPU performance by player segment"
- "What are our active player counts and login trends?"
- "Analyze our player retention patterns across segments"
- "Display our current revenue performance by platform (iOS vs Android)"

### Revenue & Monetization Analysis
- "Break down revenue by player segment and platform"
- "Analyze purchase patterns from our purchase data (Starter Pack, Crystal Packs, Gear Bundle, Character Shards, Energy Refill, Premium Pass, Hyperdrive Bundle)"
- "Which items have the highest purchase rates: gear bundles, character packs, crystal packs?"
- "Show monetization performance across different price points ($1-$5, $5-$20, $20-$50, $50+)"

### Player Engagement Metrics
- "Analyze arena battle participation and ranking patterns"
- "What are our guild participation rates across different guilds?"
- "Show character interaction and upgrade patterns across segments"
- "Analyze daily activity completion rates by player segment"

## 🎨 Creative Optimization Agent

**Purpose**: Analyzes creative performance and messaging effectiveness from campaign data.

### Creative Performance Analysis
- "Compare performance of different campaign types across channels"
- "Which campaign themes perform best: 'Summer Legends Event', 'New Player Welcome', 'Holiday Special Offer', 'Arena Championship', 'Guild Wars Promotion'?"
- "Analyze budget efficiency and ROI for different campaign types"
- "Which campaign styles work best for different platforms (Google vs Facebook vs Unity Ads)?"

### Messaging & CTA Optimization
- "Compare performance of acquisition vs retention campaigns"
- "Which messaging themes resonate best with different audience segments (returning_players, new_players, whales)?"
- "Analyze campaign budget allocation and optimization recommendations"
- "What campaign variations should we test for upcoming initiatives?"

## 📊 Trend Analysis Agent

**Purpose**: Identifies trends and patterns in player behavior evolution.

### Player Behavior Evolution
- "Analyze how player preferences have changed from account creation to current state"
- "Show character interaction trends over time for different player cohorts"
- "Which characters (Zephyr Nightshade, Kael Shadowborn, Vex Ironheart, etc.) are gaining or losing popularity among different segments?"
- "Analyze spending pattern evolution as players progress through segments"

### Seasonal & Temporal Patterns
- "Identify patterns in login behavior and last login timing"
- "Analyze purchase timing patterns across different months (July-October 2025)"
- "Show arena ranking trends and competitive behavior changes"
- "Which gameplay activities (arena battles, guild activities, character upgrades) show the strongest engagement trends?"

## 🔍 Fact-Checking Agent

**Purpose**: Verifies claims against actual data in the knowledge base.

### Data Verification
- "Fact-check: What's the actual budget for our Summer Legends Event campaign?"
- "Verify: How many players currently own legendary heroes?"
- "Check: What's the real average combat power for whale segment players?"
- "Validate: Which platform (iOS vs Android) actually has higher player counts?"

## 🔴 Real-Time Monitor Agent

**Purpose**: Analyzes live game telemetry, current error rates, and recent proactive alerts from the monitoring system.

### Live Game Health
- "What's the current session drop rate? Are there any spikes?"
- "Show me live battle error metrics for the last 30 minutes"
- "Are there any active purchase failure spikes right now?"
- "What does the current churn signal rate look like?"

### Recent Alerts & Anomalies
- "What alerts has the monitoring system detected recently?"
- "Show me the latest proactive analysis reports"
- "Are there any ongoing incidents affecting players?"
- "Compare current session drop rates against historical baselines"

### Platform & Region Health
- "Which platforms are seeing the most errors right now?"
- "Are there any region-specific issues in the live metrics?"
- "Show me the current API abuse detection status"
- "What's the real-time player login rate across regions?"`;

export function parseQuestionsFromMarkdown(): QuestionCategory[] {
    const categories: QuestionCategory[] = [];
    const lines = questionsData.split("\n");

    let currentCategory: QuestionCategory | null = null;
    let currentSubcategory = "";

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Match demo section (## 🎯 **DEMO JOURNEY - Guided Question Flow**)
        const demoMatch = line.match(/^## 🎯 \*\*DEMO JOURNEY - Guided Question Flow\*\*/);
        if (demoMatch) {
            // Extract description from next lines
            let description = "";
            const j = i + 1;
            while (j < lines.length && lines[j].trim().startsWith("**Purpose**:")) {
                description = lines[j].replace("**Purpose**:", "").trim();
                break;
            }
            if (!description) {
                description =
                    "Complete demo experience showcasing all Agentic Live Ops capabilities through a structured journey from discovery to strategic recommendations.";
            }

            currentCategory = {
                name: "🎯 Demo Journey",
                agentType: "Demo Journey",
                icon: "🎯",
                description,
                questions: [],
            };

            categories.push(currentCategory);
            continue;
        }

        // Match main agent sections (## 🎯 Player Character Targeting Agent)
        const agentMatch = line.match(/^## (.+?) Agent/);
        if (agentMatch) {
            const fullTitle = agentMatch[1];
            const icon = line.match(/^## (.)/)?.[1] || "🤖";

            // Extract agent type and description from next lines
            let description = "";
            const j = i + 1;
            while (j < lines.length && lines[j].trim().startsWith("**Purpose**:")) {
                description = lines[j].replace("**Purpose**:", "").trim();
                break;
            }

            currentCategory = {
                name: fullTitle,
                agentType: fullTitle.replace(/[🎯📊🚀🔍📈]/g, "").trim(),
                icon,
                description,
                questions: [],
            };

            categories.push(currentCategory);
            continue;
        }

        // Match subcategory headers (### Character Demand Analysis)
        const subcategoryMatch = line.match(/^### (.+)$/);
        if (subcategoryMatch && currentCategory) {
            currentSubcategory = subcategoryMatch[1];
            continue;
        }

        // Match questions (lines starting with -)
        const questionMatch = line.match(/^- "(.+)"$/);
        if (questionMatch && currentCategory) {
            const questionText = questionMatch[1];
            const questionId = `${currentCategory.agentType.toLowerCase().replace(/\s+/g, "-")}-${currentCategory.questions.length + 1}`;

            // Extract tags from question text
            const tags: string[] = [];
            if (questionText.toLowerCase().includes("character")) tags.push("character");
            if (questionText.toLowerCase().includes("player")) tags.push("player");
            if (questionText.toLowerCase().includes("campaign")) tags.push("campaign");
            if (questionText.toLowerCase().includes("segment")) tags.push("segment");
            if (questionText.toLowerCase().includes("retention")) tags.push("retention");
            if (questionText.toLowerCase().includes("whale")) tags.push("whale");
            if (questionText.toLowerCase().includes("spending")) tags.push("spending");
            if (questionText.toLowerCase().includes("kpi")) tags.push("kpi");
            if (questionText.toLowerCase().includes("messaging")) tags.push("messaging");
            if (questionText.toLowerCase().includes("acquisition")) tags.push("acquisition");
            if (questionText.toLowerCase().includes("strategy")) tags.push("strategy");
            if (questionText.toLowerCase().includes("implementation")) tags.push("implementation");
            if (questionText.toLowerCase().includes("comprehensive")) tags.push("comprehensive");
            if (questionText.toLowerCase().includes("approach")) tags.push("approach");
            if (questionText.toLowerCase().includes("historical")) tags.push("historical");
            if (questionText.toLowerCase().includes("representation")) tags.push("representation");
            if (questionText.toLowerCase().includes("3 year")) tags.push("projections");
            if (questionText.toLowerCase().includes("recommend")) tags.push("recommendations");
            if (questionText.toLowerCase().includes("next corner")) tags.push("strategic");
            if (
                questionText.toLowerCase().includes("revenue") ||
                questionText.toLowerCase().includes("monetization")
            )
                tags.push("revenue");
            if (
                questionText.toLowerCase().includes("free-to-play") ||
                questionText.toLowerCase().includes("f2p") ||
                questionText.toLowerCase().includes("never spend") ||
                questionText.toLowerCase().includes("non-paying")
            )
                tags.push("f2p");

            // Add demo-specific tags
            if (currentCategory.agentType === "Demo Journey") {
                tags.push("demo");
                if (currentSubcategory.toLowerCase().includes("discovery")) tags.push("discovery");
                if (currentSubcategory.toLowerCase().includes("acquisition"))
                    tags.push("acquisition");
                if (currentSubcategory.toLowerCase().includes("segmentation"))
                    tags.push("segmentation");
                if (currentSubcategory.toLowerCase().includes("strategy")) tags.push("strategy");
                if (currentSubcategory.toLowerCase().includes("implementation"))
                    tags.push("implementation");
                if (currentSubcategory.toLowerCase().includes("kpi")) tags.push("kpi");
                if (currentSubcategory.toLowerCase().includes("historical"))
                    tags.push("historical");
                if (currentSubcategory.toLowerCase().includes("projections"))
                    tags.push("projections");
                if (currentSubcategory.toLowerCase().includes("strategic")) tags.push("strategic");
                if (currentSubcategory.toLowerCase().includes("recommendations"))
                    tags.push("recommendations");
                if (currentSubcategory.toLowerCase().includes("quick")) tags.push("quick-demo");
            }

            const question: Question = {
                id: questionId,
                text: questionText,
                category: currentSubcategory,
                agentType: currentCategory.agentType,
                tags,
                description: `${currentSubcategory} question for ${currentCategory.agentType}`,
            };

            currentCategory.questions.push(question);
        }
    }

    return categories;
}

export function searchQuestions(categories: QuestionCategory[], searchTerm: string): Question[] {
    const results: Question[] = [];
    const lowerSearchTerm = searchTerm.toLowerCase();

    categories.forEach((category) => {
        category.questions.forEach((question: Question) => {
            if (
                question.text.toLowerCase().includes(lowerSearchTerm) ||
                question.category.toLowerCase().includes(lowerSearchTerm) ||
                question.agentType.toLowerCase().includes(lowerSearchTerm) ||
                question.tags.some((tag: string) => tag.toLowerCase().includes(lowerSearchTerm))
            ) {
                results.push(question);
            }
        });
    });

    return results;
}

export function filterQuestionsByCategory(
    categories: QuestionCategory[],
    agentType: string
): Question[] {
    const category = categories.find((cat) => cat.agentType === agentType);
    return category ? category.questions : [];
}
