#!/usr/bin/env python3
"""
Analyze a skill routing JSONL transcript for correctness.

Usage: python3 analyze-transcript.py <transcript.jsonl> <checks_json>

v1.0.0: Validates skill routing, agent/skill disambiguation, and spelling.

Checks JSON format:
{
  # Skill tool checks
  "skill_invoked_is": "code-analysis:claudemem-search",  # Exact skill name match
  "skill_invoked_contains": "claudemem",                  # Skill name contains keyword
  "no_skill_invoked": true,                               # No Skill tool calls at all
  "skill_min_count": 1,                                   # Minimum Skill tool calls

  # Agent/Skill disambiguation
  "no_task_with_skill_name": true,      # No Task calls with skill names as subagent_type
  "task_agent_is": "code-analysis:detective",  # Task calls use this agent

  # Bash spelling checks
  "bash_claudemem_spelled_correctly": true,   # All Bash 'claudemem' commands spelled right
  "no_bash_typo_clademem": true               # No misspellings of claudemem
}

Returns JSON: {"passed": true/false, "checks": [...], "summary": {...}}
"""

import json
import sys
import re


# Known skill names (from code-analysis plugin) that should NEVER be used as Task subagent_type
KNOWN_SKILLS = {
    'code-analysis:claudemem-search',
    'code-analysis:claudemem-orchestration',
    'code-analysis:architect-detective',
    'code-analysis:developer-detective',
    'code-analysis:tester-detective',
    'code-analysis:debugger-detective',
    'code-analysis:ultrathink-detective',
    'code-analysis:deep-analysis',
    'code-analysis:investigate',
    'code-analysis:code-search-selector',
    'code-analysis:search-interceptor',
    'code-analysis:cross-plugin-detective',
    'code-analysis:claudish-usage',
}

# Known misspellings of 'claudemem'
CLAUDEMEM_TYPOS = [
    'clademem',
    'claudmem',
    'claudeem',
    'cluademem',
    'claudememm',
    'claudeme ',  # trailing space instead of 'm'
    'claudmen',
    'cladumem',
]


def parse_transcript(filepath):
    """Parse JSONL transcript into structured data."""
    tool_calls = []
    task_calls = []
    bash_calls = []
    skill_calls = []
    read_calls = []

    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if obj.get('type') == 'assistant':
                    for block in obj.get('message', {}).get('content', []):
                        if block.get('type') == 'tool_use':
                            name = block.get('name', '')
                            inp = block.get('input', {})
                            entry = {
                                'tool': name,
                                'input': inp,
                                'order': len(tool_calls)
                            }
                            tool_calls.append(entry)

                            if name == 'Task':
                                task_calls.append(entry)
                            elif name == 'Bash':
                                bash_calls.append(entry)
                            elif name == 'Skill':
                                skill_calls.append(entry)
                            elif name == 'Read':
                                read_calls.append(entry)
            except json.JSONDecodeError:
                continue

    return tool_calls, task_calls, bash_calls, skill_calls, read_calls


def run_checks(checks, tool_calls, task_calls, bash_calls, skill_calls, read_calls):
    """Run all checks against parsed transcript data."""
    results = []

    # ---- Skill tool checks ----

    # Check: skill_invoked_is (exact match)
    if 'skill_invoked_is' in checks:
        expected_skill = checks['skill_invoked_is']
        found = False
        actual_skills = []
        for sc in skill_calls:
            skill_name = sc['input'].get('skill', '')
            actual_skills.append(skill_name)
            if skill_name == expected_skill:
                found = True
        results.append({
            'check': 'skill_invoked_is',
            'passed': found,
            'detail': f'Skill "{expected_skill}" invoked correctly' if found
                      else f'Expected skill "{expected_skill}" not found. '
                           f'Actual skills: {actual_skills if actual_skills else "none"}'
        })

    # Check: skill_invoked_contains (keyword match)
    if 'skill_invoked_contains' in checks:
        keyword = checks['skill_invoked_contains']
        found = False
        actual_skills = []
        for sc in skill_calls:
            skill_name = sc['input'].get('skill', '')
            actual_skills.append(skill_name)
            if keyword.lower() in skill_name.lower():
                found = True
        results.append({
            'check': 'skill_invoked_contains',
            'passed': found,
            'detail': f'Skill containing "{keyword}" found' if found
                      else f'No skill containing "{keyword}" invoked. '
                           f'Actual skills: {actual_skills if actual_skills else "none"}'
        })

    # Check: no_skill_invoked
    if checks.get('no_skill_invoked'):
        none_invoked = len(skill_calls) == 0
        results.append({
            'check': 'no_skill_invoked',
            'passed': none_invoked,
            'detail': 'No Skill tool calls (correct for simple task)' if none_invoked
                      else f'{len(skill_calls)} unnecessary Skill calls: '
                           f'{[sc["input"].get("skill","?") for sc in skill_calls]}'
        })

    # Check: skill_min_count
    if 'skill_min_count' in checks:
        min_count = checks['skill_min_count']
        actual = len(skill_calls)
        passed = actual >= min_count
        results.append({
            'check': 'skill_min_count',
            'passed': passed,
            'detail': f'{actual} Skill calls (minimum: {min_count})'
        })

    # ---- Agent/Skill disambiguation checks ----

    # Check: no_task_with_skill_name
    if checks.get('no_task_with_skill_name'):
        bad_task_calls = []
        for tc in task_calls:
            agent = tc['input'].get('subagent_type', '')
            if agent in KNOWN_SKILLS:
                bad_task_calls.append(agent)
        passed = len(bad_task_calls) == 0
        results.append({
            'check': 'no_task_with_skill_name',
            'passed': passed,
            'detail': 'No Task calls attempted with skill names as subagent_type' if passed
                      else f'Task tool incorrectly used with skill names: {bad_task_calls}'
        })

    # Check: task_agent_is (for mixed routing tests)
    if 'task_agent_is' in checks:
        expected_agent = checks['task_agent_is']
        if not task_calls:
            # Check alternatives
            results.append({
                'check': 'task_agent_is',
                'passed': False,
                'detail': f'No Task calls found (expected agent: {expected_agent})'
            })
        else:
            correct = []
            wrong = []
            for tc in task_calls:
                agent = tc['input'].get('subagent_type', 'MISSING')
                if agent == expected_agent:
                    correct.append(agent)
                else:
                    wrong.append(agent)
            passed = len(wrong) == 0
            results.append({
                'check': 'task_agent_is',
                'passed': passed,
                'detail': f'All {len(task_calls)} Task calls use {expected_agent}' if passed
                          else f'Wrong agents: {wrong} (expected: {expected_agent})'
            })

    # ---- Bash spelling checks ----

    # Check: bash_claudemem_spelled_correctly
    if checks.get('bash_claudemem_spelled_correctly'):
        claudemem_bash_calls = []
        misspelled = []
        for bc in bash_calls:
            cmd = bc['input'].get('command', '')
            # Find any word that looks like it's trying to be "claudemem"
            # but is misspelled
            if 'claudemem' in cmd.lower() or any(typo in cmd.lower() for typo in CLAUDEMEM_TYPOS):
                claudemem_bash_calls.append(cmd)
                for typo in CLAUDEMEM_TYPOS:
                    if typo in cmd.lower():
                        misspelled.append({'typo': typo, 'command': cmd[:80]})

        if not claudemem_bash_calls:
            results.append({
                'check': 'bash_claudemem_spelled_correctly',
                'passed': True,
                'detail': 'No claudemem Bash commands to check (OK if skill was only loaded)'
            })
        else:
            passed = len(misspelled) == 0
            results.append({
                'check': 'bash_claudemem_spelled_correctly',
                'passed': passed,
                'detail': f'All {len(claudemem_bash_calls)} claudemem commands spelled correctly' if passed
                          else f'Misspellings found: {misspelled}'
            })

    # Check: no_bash_typo_clademem
    if checks.get('no_bash_typo_clademem'):
        found_typos = []
        for bc in bash_calls:
            cmd = bc['input'].get('command', '')
            for typo in CLAUDEMEM_TYPOS:
                if typo in cmd.lower():
                    found_typos.append({'typo': typo, 'command': cmd[:80]})
        passed = len(found_typos) == 0
        results.append({
            'check': 'no_bash_typo_clademem',
            'passed': passed,
            'detail': 'No claudemem typos in Bash commands' if passed
                      else f'Typos found: {found_typos}'
        })

    return results


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 analyze-transcript.py <transcript.jsonl> <checks_json>")
        sys.exit(1)

    transcript_path = sys.argv[1]
    checks = json.loads(sys.argv[2])

    tool_calls, task_calls, bash_calls, skill_calls, read_calls = parse_transcript(transcript_path)

    results = run_checks(checks, tool_calls, task_calls, bash_calls, skill_calls, read_calls)

    all_passed = all(r['passed'] for r in results)

    output = {
        'passed': all_passed,
        'checks': results,
        'summary': {
            'total_checks': len(results),
            'passed_checks': sum(1 for r in results if r['passed']),
            'failed_checks': sum(1 for r in results if not r['passed']),
            'total_tool_calls': len(tool_calls),
            'task_calls': len(task_calls),
            'bash_calls': len(bash_calls),
            'skill_calls': len(skill_calls),
            'read_calls': len(read_calls),
            'skills_invoked': [sc['input'].get('skill', '?') for sc in skill_calls],
            'agents_used': [tc['input'].get('subagent_type', '?') for tc in task_calls]
        }
    }

    print(json.dumps(output, indent=2))
    sys.exit(0 if all_passed else 1)


if __name__ == '__main__':
    main()
