# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0

import os


class PromptLoader:
    """
    Centralized prompt loader for all liveops.
    Caches prompts in memory for better performance.
    """

    _cache = {}

    @classmethod
    def _load_agent_prompt(cls, agent_name: str) -> str:
        """
        Load agent system prompt from the prompts directory.

        Args:
            agent_name: Name of the agent (e.g., "orchestrator", "performance_metrics", "player_targeting")

        Returns:
            str: Content of the agent's prompt file

        Raises:
            FileNotFoundError: If the prompt file doesn't exist
        """
        current_dir = os.path.dirname(os.path.abspath(__file__))
        prompts_dir = os.path.join(current_dir, "..", "prompts")
        prompt_file = os.path.join(prompts_dir, f"{agent_name}.md")

        try:
            with open(prompt_file, "r", encoding="utf-8") as f:
                content = f.read()
                # Remove markdown headers and clean up the content
                lines = content.split("\n")
                # Skip the first line if it's a markdown header
                if lines and lines[0].startswith("# "):
                    lines = lines[1:]
                # Remove any empty lines at the beginning
                while lines and not lines[0].strip():
                    lines.pop(0)
                return "\n".join(lines).strip()
        except FileNotFoundError:
            raise FileNotFoundError(f"Prompt file not found: {prompt_file}")

    @classmethod
    def get_prompt(
        cls, agent_name: str, domain_context: str = "", domain_label: str = "generic"
    ) -> str:
        """
        Get the system prompt for a specific agent.

        Args:
            agent_name: Name of the agent
            domain_context: Domain context to prepend to the prompt
            domain_label: Domain identifier for {{domain}} placeholder substitution

        Returns:
            str: Complete system prompt with domain substitution and domain context
        """
        if agent_name not in cls._cache:
            try:
                cls._cache[agent_name] = cls._load_agent_prompt(agent_name)
            except FileNotFoundError:
                # Fallback to a basic prompt if file not found
                cls._cache[agent_name] = (
                    f"{agent_name.replace('_', ' ').title()} Agent. Provide analytics insights."
                )

        prompt = cls._cache[agent_name]
        prompt = prompt.replace("{{domain}}", domain_label)

        if domain_context:
            return f"{domain_context}\n\n{prompt}"
        return prompt

    @classmethod
    def clear_cache(cls):
        """Clear the prompt cache. Useful for development/testing."""
        cls._cache.clear()
