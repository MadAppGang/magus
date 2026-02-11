#!/usr/bin/env python3
"""
Analyze a /team command JSONL transcript for orchestration correctness.

Usage: python3 analyze-transcript.py <transcript.jsonl> <checks_json>

Checks JSON format:
{
  "task_agent_is": "dev:researcher",     # All Task calls use this agent
  "task_min_count": 2,                   # Minimum number of Task calls
  "has_proxy_mode": true,                # At least one Task prompt has PROXY_MODE
  "proxy_mode_first_line": true,         # PROXY_MODE is on the first line of prompt
  "proxy_mode_model_contains": "grok",   # PROXY_MODE line contains this string
  "no_proxy_mode_for_internal": true,    # Internal model Task has no PROXY_MODE
  "run_in_background": true,             # Task calls use run_in_background
  "has_vote_template": true,             # Task prompt contains vote template text
  "has_vote_format": true,               # Task prompt contains vote format block
  "no_predigest": true,                  # No Read/Grep/Glob/WebSearch before first Task
  "session_dir_pattern": "ai-docs/sessions/", # Bash mkdir uses this pattern
  "no_tmp_dir": true                     # No /tmp/ in Bash mkdir calls
}

Returns JSON: {"passed": true/false, "checks": [...], "details": {...}}
"""

import json
import sys
import re

def parse_transcript(filepath):
    """Parse JSONL transcript into structured data."""
    tool_calls = []  # All tool calls in order
    task_calls = []  # Just Task tool calls
    bash_calls = []  # Just Bash tool calls

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
            except json.JSONDecodeError:
                continue

    return tool_calls, task_calls, bash_calls


def run_checks(checks, tool_calls, task_calls, bash_calls):
    """Run all checks against parsed transcript data."""
    results = []

    # Check: task_agent_is
    if 'task_agent_is' in checks:
        expected_agent = checks['task_agent_is']
        if not task_calls:
            results.append({
                'check': 'task_agent_is',
                'passed': False,
                'detail': f'No Task calls found (expected agent: {expected_agent})'
            })
        else:
            wrong_agents = []
            for tc in task_calls:
                agent = tc['input'].get('subagent_type', 'MISSING')
                if agent != expected_agent:
                    wrong_agents.append(agent)
            if wrong_agents:
                results.append({
                    'check': 'task_agent_is',
                    'passed': False,
                    'detail': f'Wrong agents used: {wrong_agents} (expected: {expected_agent})'
                })
            else:
                results.append({
                    'check': 'task_agent_is',
                    'passed': True,
                    'detail': f'All {len(task_calls)} Task calls use {expected_agent}'
                })

    # Check: task_min_count
    if 'task_min_count' in checks:
        min_count = checks['task_min_count']
        actual = len(task_calls)
        passed = actual >= min_count
        results.append({
            'check': 'task_min_count',
            'passed': passed,
            'detail': f'{actual} Task calls (minimum: {min_count})'
        })

    # Check: has_proxy_mode
    if checks.get('has_proxy_mode'):
        found_proxy = False
        for tc in task_calls:
            prompt = tc['input'].get('prompt', '')
            if 'PROXY_MODE' in prompt:
                found_proxy = True
                break
        results.append({
            'check': 'has_proxy_mode',
            'passed': found_proxy,
            'detail': 'PROXY_MODE found in Task prompt' if found_proxy else 'No PROXY_MODE found in any Task prompt'
        })

    # Check: proxy_mode_first_line
    if checks.get('proxy_mode_first_line'):
        all_first_line = True
        detail_parts = []
        for tc in task_calls:
            prompt = tc['input'].get('prompt', '')
            if 'PROXY_MODE' in prompt:
                first_line = prompt.strip().split('\n')[0].strip()
                if first_line.startswith('PROXY_MODE'):
                    detail_parts.append(f'OK: "{first_line[:60]}"')
                else:
                    all_first_line = False
                    detail_parts.append(f'WRONG first line: "{first_line[:60]}"')
        if not detail_parts:
            all_first_line = False
            detail_parts.append('No PROXY_MODE found in any Task')
        results.append({
            'check': 'proxy_mode_first_line',
            'passed': all_first_line,
            'detail': '; '.join(detail_parts)
        })

    # Check: proxy_mode_model_contains
    if 'proxy_mode_model_contains' in checks:
        keyword = checks['proxy_mode_model_contains']
        found = False
        detail = ''
        for tc in task_calls:
            prompt = tc['input'].get('prompt', '')
            # Look for PROXY_MODE line
            for pline in prompt.split('\n'):
                if pline.strip().startswith('PROXY_MODE'):
                    model_id = pline.split(':', 1)[1].strip() if ':' in pline else ''
                    if keyword.lower() in model_id.lower():
                        found = True
                        detail = f'Found: PROXY_MODE: {model_id}'
                        break
            if found:
                break
        if not found:
            detail = f'No PROXY_MODE line containing "{keyword}" found'
        results.append({
            'check': 'proxy_mode_model_contains',
            'passed': found,
            'detail': detail
        })

    # Check: no_proxy_mode_for_internal
    if checks.get('no_proxy_mode_for_internal'):
        # For internal-only tests, NO Task should have PROXY_MODE
        has_proxy = False
        for tc in task_calls:
            prompt = tc['input'].get('prompt', '')
            if 'PROXY_MODE' in prompt:
                has_proxy = True
                break
        results.append({
            'check': 'no_proxy_mode_for_internal',
            'passed': not has_proxy,
            'detail': 'No PROXY_MODE in Task prompts (correct for internal)' if not has_proxy
                      else 'Found PROXY_MODE in Task prompt for internal model'
        })

    # Check: run_in_background
    if checks.get('run_in_background'):
        all_bg = True
        for tc in task_calls:
            if not tc['input'].get('run_in_background', False):
                all_bg = False
                break
        results.append({
            'check': 'run_in_background',
            'passed': all_bg,
            'detail': f'All {len(task_calls)} Task calls use run_in_background' if all_bg
                      else 'Some Task calls missing run_in_background=true'
        })

    # Check: has_vote_template
    if checks.get('has_vote_template'):
        found = False
        for tc in task_calls:
            prompt = tc['input'].get('prompt', '')
            if 'Team Vote' in prompt or 'Independent Review' in prompt:
                found = True
                break
        results.append({
            'check': 'has_vote_template',
            'passed': found,
            'detail': 'Vote template found in Task prompt' if found
                      else 'No vote template text found in any Task prompt'
        })

    # Check: has_vote_format
    if checks.get('has_vote_format'):
        found = False
        for tc in task_calls:
            prompt = tc['input'].get('prompt', '')
            if 'VERDICT' in prompt and ('APPROVE' in prompt or 'REJECT' in prompt):
                found = True
                break
        results.append({
            'check': 'has_vote_format',
            'passed': found,
            'detail': 'Vote format block found' if found
                      else 'No VERDICT/APPROVE/REJECT format found in Task prompts'
        })

    # Check: no_predigest
    if checks.get('no_predigest'):
        # Find the index of the first Task call
        first_task_order = task_calls[0]['order'] if task_calls else 999999
        # Check if any investigation tools were called before the first Task
        investigation_tools = {'Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'}
        # Whitelist: setup-related reads are NOT pre-digestion
        setup_patterns = [
            'multimodel-team.json',   # Preferences file (Step 1b)
            'settings.json',          # Settings check
        ]
        predigest_calls = []
        for tc in tool_calls:
            if tc['order'] < first_task_order and tc['tool'] in investigation_tools:
                # Check if this is a whitelisted setup read
                file_path = tc['input'].get('file_path', '')
                is_setup = any(pat in file_path for pat in setup_patterns)
                if not is_setup:
                    predigest_calls.append(tc['tool'])
        # Allow Bash calls for setup (mkdir, which claudish, etc) but not investigation
        passed = len(predigest_calls) == 0
        results.append({
            'check': 'no_predigest',
            'passed': passed,
            'detail': f'No pre-digestion tools before Task' if passed
                      else f'Pre-digestion detected: {predigest_calls} called before first Task'
        })

    # Check: session_dir_pattern
    if 'session_dir_pattern' in checks:
        pattern = checks['session_dir_pattern']
        found = False
        for bc in bash_calls:
            cmd = bc['input'].get('command', '')
            if 'mkdir' in cmd and pattern in cmd:
                found = True
                break
        results.append({
            'check': 'session_dir_pattern',
            'passed': found,
            'detail': f'Session dir with "{pattern}" found in mkdir' if found
                      else f'No mkdir with "{pattern}" found in Bash calls'
        })

    # Check: no_tmp_dir
    if checks.get('no_tmp_dir'):
        has_tmp = False
        for bc in bash_calls:
            cmd = bc['input'].get('command', '')
            if 'mkdir' in cmd and '/tmp/' in cmd:
                has_tmp = True
                break
        # Also check Task prompts for /tmp/ paths
        for tc in task_calls:
            prompt = tc['input'].get('prompt', '')
            if '/tmp/' in prompt:
                has_tmp = True
                break
        results.append({
            'check': 'no_tmp_dir',
            'passed': not has_tmp,
            'detail': 'No /tmp/ paths found' if not has_tmp
                      else 'Found /tmp/ path in Bash mkdir or Task prompt'
        })

    return results


def main():
    if len(sys.argv) < 3:
        print("Usage: python3 analyze-transcript.py <transcript.jsonl> <checks_json>")
        sys.exit(1)

    transcript_path = sys.argv[1]
    checks = json.loads(sys.argv[2])

    tool_calls, task_calls, bash_calls = parse_transcript(transcript_path)

    results = run_checks(checks, tool_calls, task_calls, bash_calls)

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
            'bash_calls': len(bash_calls)
        }
    }

    print(json.dumps(output, indent=2))
    sys.exit(0 if all_passed else 1)


if __name__ == '__main__':
    main()
